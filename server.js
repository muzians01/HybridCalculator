"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return year >= 1000 && month >= 1 && month <= 12 &&
    day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validateData(value) {
  if (!value || !Array.isArray(value.holidays) || !Array.isArray(value.absences) ||
      !Array.isArray(value.officeDays)) {
    throw new Error("Expected holidays, absences and officeDays arrays.");
  }
  for (const [items, kind] of [[value.holidays, "holiday"], [value.absences, "absence"]]) {
    const ids = new Set();
    for (const item of items) {
      if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) ||
          !validDate(item.date) ||
          (kind === "holiday" && (
            typeof item.name !== "string" || !item.name.trim() ||
            !["public", "floating"].includes(item.type) || typeof item.selected !== "boolean"
          )) ||
          (kind === "absence" && !["leave", "exception"].includes(item.type))) {
        throw new Error(`Invalid or duplicate ${kind} entry.`);
      }
      ids.add(item.id);
    }
  }
  if (!value.officeDays.every(validDate) || new Set(value.officeDays).size !== value.officeDays.length) {
    throw new Error("Office days must be unique valid dates.");
  }
  return { holidays: value.holidays, absences: value.absences, officeDays: value.officeDays };
}

function retainCurrentAndPreviousYear(value, currentYear = new Date().getFullYear()) {
  const isRetained = (date) => {
    const year = Number(date.slice(0, 4));
    return year === currentYear || year === currentYear - 1;
  };
  const retained = {
    holidays: value.holidays.filter((holiday) => isRetained(holiday.date)),
    absences: value.absences.filter((absence) => isRetained(absence.date)),
    officeDays: value.officeDays.filter(isRetained)
  };
  const floatingCounts = new Map();
  for (const holiday of retained.holidays) {
    if (holiday.type !== "floating" || !holiday.selected) continue;
    const year = holiday.date.slice(0, 4);
    floatingCounts.set(year, (floatingCounts.get(year) || 0) + 1);
    if (floatingCounts.get(year) > 2) throw new Error(`More than two floating holidays selected for ${year}.`);
  }
  return retained;
}

async function writeDataFile(dataPath, data) {
  const temporaryPath = `${dataPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
    await fs.rename(temporaryPath, dataPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

function createCalculatorServer(dataPath = path.join(__dirname, "office-days-data.json")) {
  let writeQueue = Promise.resolve();
  const assets = new Map([
    ["/", ["index.html", "text/html"]],
    ["/index.html", ["index.html", "text/html"]],
    ["/app.js", ["app.js", "text/javascript"]],
    ["/styles.css", ["styles.css", "text/css"]]
  ]);

  return http.createServer(async (request, response) => {
    const json = (status, value) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(value));
    };
    if (request.headers.host !== `127.0.0.1:${request.socket.localPort}`) {
      json(403, { error: "Use the local 127.0.0.1 address." });
      return;
    }
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    try {
      if (pathname === "/api/health" && request.method === "GET") {
        json(200, { app: "office-days-calculator", directory: __dirname });
        return;
      }
      if (pathname === "/api/data" && request.method === "GET") {
        const read = writeQueue.then(async () => {
          const stored = validateData(JSON.parse(await fs.readFile(dataPath, "utf8")));
          const retained = retainCurrentAndPreviousYear(stored);
          if (JSON.stringify(stored) !== JSON.stringify(retained)) {
            await writeDataFile(dataPath, retained);
          }
          return retained;
        });
        writeQueue = read.catch((error) => console.error("Data cleanup failed:", error));
        json(200, await read);
        return;
      }
      if (pathname === "/api/data" && request.method === "PUT") {
        if (request.headers.origin !== `http://${request.headers.host}` ||
            request.headers["content-type"] !== "application/json") {
          json(403, { error: "Only same-origin JSON updates are allowed." });
          return;
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 1024 * 1024) {
            json(413, { error: "Data file exceeds the 1 MB limit." });
            return;
          }
          chunks.push(chunk);
        }
        let data;
        try {
          data = validateData(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          const retained = retainCurrentAndPreviousYear(data);
          if (JSON.stringify(data) !== JSON.stringify(retained)) {
            throw new Error("Dates must be in the current or previous year.");
          }
          data = retained;
        } catch (error) {
          json(400, { error: error.message });
          return;
        }
        const write = writeQueue.then(async () => {
          await writeDataFile(dataPath, data);
        });
        writeQueue = write.catch((error) => console.error("Data save failed:", error));
        await write;
        json(200, { saved: true });
        return;
      }
      if (request.method === "GET" && assets.has(pathname)) {
        const [filename, type] = assets.get(pathname);
        const content = await fs.readFile(path.join(__dirname, filename));
        response.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
        response.end(content);
        return;
      }
      json(404, { error: "Not found." });
    } catch (error) {
      console.error("Request failed:", error);
      json(500, { error: `Local file operation failed: ${error.message}` });
    }
  });
}

if (require.main === module) {
  const url = "http://127.0.0.1:3000";
  const openRequested = process.argv.includes("--open");
  function openBrowser() {
    const browser = spawn("explorer.exe", [url], { stdio: "ignore" });
    browser.on("error", (error) => {
      console.error(`Could not open the browser: ${error.message}. Open ${url} manually.`);
    });
  }
  const server = createCalculatorServer();
  server.on("error", async (error) => {
    if (openRequested && error.code === "EADDRINUSE") {
      try {
        const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
        const running = await response.json();
        if (!response.ok || running.app !== "office-days-calculator" || running.directory !== __dirname) {
          throw new Error("Port 3000 is used by a different app or calculator folder");
        }
        console.log("Calculator is already running. Opening the browser.");
        openBrowser();
        return;
      } catch (connectionError) {
        console.error(`Could not reuse the server: ${connectionError.message}. Close the other app using port 3000 and try again.`);
        process.exitCode = 1;
        return;
      }
    }
    console.error(`Could not start calculator: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(3000, "127.0.0.1", () => {
    console.log(`Office Days Calculator: ${url}`);
    if (openRequested) openBrowser();
  });
}

module.exports = { createCalculatorServer };
