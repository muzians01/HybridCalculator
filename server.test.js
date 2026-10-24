"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createCalculatorServer } = require("./server");

async function startServer(dataPath) {
  const server = createCalculatorServer(dataPath);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("JSON storage persists across server restarts and rejects invalid updates", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hybrid-calculator-test-"));
  const dataPath = path.join(directory, "data.json");
  const currentYear = new Date().getFullYear();
  const dateForYear = (year, month = "11", day = "02") => `${year}-${month}-${day}`;
  const retainYears = (data) => ({
    holidays: data.holidays.filter((item) => Number(item.date.slice(0, 4)) >= currentYear - 1 &&
      Number(item.date.slice(0, 4)) <= currentYear),
    absences: data.absences.filter((item) => Number(item.date.slice(0, 4)) >= currentYear - 1 &&
      Number(item.date.slice(0, 4)) <= currentYear),
    officeDays: data.officeDays.filter((date) => Number(date.slice(0, 4)) >= currentYear - 1 &&
      Number(date.slice(0, 4)) <= currentYear)
  });
  const initial = JSON.parse(await fs.readFile(path.join(__dirname, "office-days-data.json"), "utf8"));
  initial.holidays.push({
    id: "previous-year-holiday",
    date: dateForYear(currentYear - 1, "01", "15"),
    name: "Previous-year holiday",
    type: "public",
    selected: true
  });
  initial.absences.push({
    id: "previous-year-leave",
    date: dateForYear(currentYear - 1, "01", "16"),
    type: "leave"
  });
  initial.officeDays.push(dateForYear(currentYear - 1, "01", "17"));
  const expectedInitial = retainYears(initial);
  await fs.writeFile(dataPath, JSON.stringify(initial));
  let running = await startServer(dataPath);
  try {
    const loaded = await (await fetch(`${running.url}/api/data`)).json();
    assert.deepEqual(loaded, expectedInitial);
    const update = {
      ...loaded,
      officeDays: [dateForYear(currentYear), dateForYear(currentYear, "11", "03")]
    };
    const put = (data, origin = running.url) => fetch(`${running.url}/api/data`, {
      method: "PUT",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    assert.equal((await put(update)).status, 200);
    assert.deepEqual(JSON.parse(await fs.readFile(dataPath, "utf8")), update);

    assert.equal((await put({ ...update, officeDays: [dateForYear(currentYear, "02", "30")] })).status, 400);
    assert.equal((await put({
      ...update,
      officeDays: [dateForYear(currentYear), dateForYear(currentYear)]
    })).status, 400);
    assert.equal((await put({
      ...update,
      officeDays: [...update.officeDays, dateForYear(currentYear + 1)]
    })).status, 400);
    assert.equal((await put({
      ...update,
      holidays: [...update.holidays, {
        id: "outside-retention-window",
        date: dateForYear(currentYear - 2),
        name: "Out of range",
        type: "public",
        selected: true
      }]
    })).status, 400);
    assert.equal((await put({ ...update, holidays: [null] })).status, 400);
    assert.equal((await put(update, "https://untrusted.example")).status, 403);
    assert.deepEqual(JSON.parse(await fs.readFile(dataPath, "utf8")), update);
    assert.equal((await fetch(`${running.url}/server.js`)).status, 404);
    assert.equal((await fetch(running.url)).status, 200);
    const health = await (await fetch(`${running.url}/api/health`)).json();
    assert.deepEqual(health, { app: "office-days-calculator", directory: __dirname });
    assert.deepEqual(await fs.readdir(directory), ["data.json"]);

    const staleData = {
      ...update,
      absences: [...update.absences, {
        id: "stale-leave",
        date: dateForYear(currentYear - 2),
        type: "leave"
      }],
      officeDays: [...update.officeDays, dateForYear(currentYear + 1)]
    };
    await fs.writeFile(dataPath, JSON.stringify(staleData));
    assert.deepEqual(await (await fetch(`${running.url}/api/data`)).json(), update);
    assert.deepEqual(JSON.parse(await fs.readFile(dataPath, "utf8")), update);

    await closeServer(running.server);
    running = await startServer(dataPath);
    assert.deepEqual(await (await fetch(`${running.url}/api/data`)).json(), update);

    await fs.writeFile(dataPath, "{invalid");
    const invalid = await fetch(`${running.url}/api/data`);
    assert.equal(invalid.status, 500);
    assert.match((await invalid.json()).error, /Local file operation failed/);
    assert.equal(await fs.readFile(dataPath, "utf8"), "{invalid");
  } finally {
    await closeServer(running.server);
    await fs.rm(dataPath, { force: true });
    await fs.rmdir(directory);
  }
});
