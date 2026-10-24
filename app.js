(() => {
  "use strict";

  const FLOATING_HOLIDAY_LIMIT = 2;
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const monthInput = document.querySelector("#month");
  const yearInput = document.querySelector("#year");
  const requiredDaysOutput = document.querySelector("#required-days");
  const targetDescription = document.querySelector("#target-description");
  const attendancePercentageOutput = document.querySelector("#attendance-percentage");
  const attendanceDescription = document.querySelector("#attendance-description");
  const workingDaysOutput = document.querySelector("#working-days");
  const excludedDaysOutput = document.querySelector("#excluded-days");
  const calendarElement = document.querySelector("#calendar");
  const calendarMonthLabel = document.querySelector("#calendar-month-label");
  const absenceForm = document.querySelector("#absence-form");
  const absenceDateInput = document.querySelector("#absence-date");
  const absenceTypeInput = document.querySelector("#absence-type");
  const absenceList = document.querySelector("#absence-list");
  const holidayForm = document.querySelector("#holiday-form");
  const holidayDateInput = document.querySelector("#holiday-date");
  const holidayNameInput = document.querySelector("#holiday-name");
  const holidayTypeInput = document.querySelector("#holiday-type");
  const holidayList = document.querySelector("#holiday-list");
  const statusElement = document.querySelector("#status");
  const fileStatus = document.querySelector("#file-status");
  const reloadFileButton = document.querySelector("#reload-file");
  const saveFileButton = document.querySelector("#save-file");
  const markedDaysOutput = document.querySelector("#marked-days");
  const markedDescription = document.querySelector("#marked-description");
  const markedPercentageOutput = document.querySelector("#marked-percentage");
  const remainingDaysOutput = document.querySelector("#remaining-days");

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  let data = { holidays: [], absences: [], officeDays: [] };
  let dataLoaded = false;
  let dirty = false;
  let pendingSaves = 0;
  let fileOperationInProgress = false;
  let saveQueue = Promise.resolve();

  async function loadData() {
    if (dirty && !window.confirm("Reloading replaces unsaved changes. Continue?")) return;
    fileOperationInProgress = true;
    updateFileControls();
    try {
      if (window.location.protocol === "file:") {
        throw new Error("Start node server.js and open http://127.0.0.1:3000 instead of opening the HTML file directly");
      }
      const response = await fetch("/api/data", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      data = result;
      dataLoaded = true;
      dirty = false;
      fileStatus.textContent = "Loaded office-days-data.json automatically. Changes are saved to that file.";
      render();
    } catch (error) {
      fileStatus.textContent = `Could not load data: ${error.message}. Use Reload data to retry.`;
    } finally {
      fileOperationInProgress = false;
      updateFileControls();
    }
  }

  function updateFileControls() {
    reloadFileButton.disabled = fileOperationInProgress || pendingSaves > 0;
    saveFileButton.disabled = !dataLoaded || !dirty || fileOperationInProgress || pendingSaves > 0;
    document.querySelectorAll("#absence-form input, #absence-form select, #absence-form button, #holiday-form input, #holiday-form select, #holiday-form button, .entry-list button, .entry-list input, .day-toggle").forEach((element) => {
      element.disabled = !dataLoaded || fileOperationInProgress;
    });
  }

  function saveData() {
    dirty = true;
    const snapshot = JSON.stringify(data, null, 2) + "\n";
    pendingSaves += 1;
    fileStatus.textContent = "Saving office-days-data.json...";
    updateFileControls();
    const operation = saveQueue.then(async () => {
      try {
        const response = await fetch("/api/data", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: snapshot
        });
        if (!response.ok) throw new Error((await response.json()).error);
        if (pendingSaves === 1) {
          dirty = false;
          fileStatus.textContent = "Saved to office-days-data.json.";
        }
        return true;
      } catch (error) {
        fileStatus.textContent = `Could not save office-days-data.json: ${error.message}. Changes remain in memory; use Retry save.`;
        return false;
      } finally {
        pendingSaves -= 1;
        updateFileControls();
      }
    });
    saveQueue = operation;
    return operation;
  }

  function setStatus(message = "") {
    statusElement.textContent = message;
  }

  function isoDate(year, monthIndex, day) {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function dateParts(dateString) {
    const parts = dateString.split("-").map(Number);
    return { year: parts[0], monthIndex: parts[1] - 1, day: parts[2] };
  }

  function selectedMonth() {
    return { year: Number(yearInput.value), monthIndex: Number(monthInput.value) };
  }

  function isRetainedYear(year) {
    const currentYear = new Date().getFullYear();
    return year === currentYear || year === currentYear - 1;
  }

  function isRetainedDate(date) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && isRetainedYear(Number(date.slice(0, 4)));
  }

  function weekdayIndex(year, monthIndex, day) {
    return (new Date(year, monthIndex, day).getDay() + 6) % 7;
  }

  function getMonthDays(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function isWeekend(year, monthIndex, day) {
    const weekday = weekdayIndex(year, monthIndex, day);
    return weekday === 5 || weekday === 6;
  }

  function holidayFor(dateString) {
    return data.holidays.filter((holiday) => holiday.date === dateString);
  }

  function absencesFor(dateString) {
    return data.absences.filter((absence) => absence.date === dateString);
  }

  function isExcluded(dateString) {
    const { year, monthIndex, day } = dateParts(dateString);
    if (isWeekend(year, monthIndex, day)) return true;
    if (holidayFor(dateString).some((holiday) => holiday.type === "public" || holiday.selected)) return true;
    return absencesFor(dateString).length > 0;
  }

  function monthStats(year, monthIndex) {
    const daysInMonth = getMonthDays(year, monthIndex);
    let weekdays = 0;
    let excludedWeekdays = 0;

    for (let day = 1; day <= daysInMonth; day += 1) {
      if (isWeekend(year, monthIndex, day)) continue;
      weekdays += 1;
      if (isExcluded(isoDate(year, monthIndex, day))) excludedWeekdays += 1;
    }

    const adjustedWorkingDays = weekdays - excludedWeekdays;
    const markedOfficeDays = data.officeDays.filter((date) => {
      const parts = dateParts(date);
      return parts.year === year && parts.monthIndex === monthIndex && !isExcluded(date);
    }).length;
    return {
      weekdays,
      excludedWeekdays,
      adjustedWorkingDays,
      markedOfficeDays,
      requiredOfficeDays: Math.ceil(adjustedWorkingDays * 0.6)
    };
  }

  function appendBadge(parent, label, className) {
    const badge = document.createElement("span");
    badge.className = `day-badge ${className}`;
    badge.textContent = label;
    badge.title = label;
    parent.append(badge);
  }

  function renderCalendar(year, monthIndex) {
    calendarElement.replaceChildren();
    calendarMonthLabel.textContent = `${MONTH_NAMES[monthIndex]} ${year}`;

    WEEKDAY_NAMES.forEach((weekday) => {
      const heading = document.createElement("div");
      heading.className = "weekday";
      heading.setAttribute("role", "columnheader");
      heading.textContent = weekday;
      calendarElement.append(heading);
    });

    const offset = weekdayIndex(year, monthIndex, 1);
    const daysInMonth = getMonthDays(year, monthIndex);
    for (let emptyIndex = 0; emptyIndex < offset; emptyIndex += 1) {
      const emptyDay = document.createElement("div");
      emptyDay.className = "day empty";
      emptyDay.setAttribute("role", "gridcell");
      emptyDay.setAttribute("aria-hidden", "true");
      calendarElement.append(emptyDay);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateString = isoDate(year, monthIndex, day);
      const weekend = isWeekend(year, monthIndex, day);
      const excluded = isExcluded(dateString);
      const marked = data.officeDays.includes(dateString);
      const cell = document.createElement("div");
      cell.className = `day${weekend ? " weekend" : ""}`;
      cell.setAttribute("role", "gridcell");

      const dateNumber = document.createElement("span");
      dateNumber.className = "date-number";
      dateNumber.textContent = String(day);
      cell.append(dateNumber);

      const badges = document.createElement("div");
      badges.className = "day-badges";
      if (weekend) appendBadge(badges, "Weekend", "weekend-label");

      holidayFor(dateString).forEach((holiday) => {
        if (holiday.type === "public") {
          appendBadge(badges, holiday.name, "public");
        } else {
          appendBadge(
            badges,
            holiday.selected ? `${holiday.name} · selected` : `${holiday.name} · optional`,
            holiday.selected ? "floating" : ""
          );
        }
      });

      absencesFor(dateString).forEach((absence) => {
        appendBadge(
          badges,
          absence.type === "leave" ? "Leave" : "Approved exception",
          absence.type
        );
      });

      if (!excluded) appendBadge(badges, marked ? "Office day" : "Working day", marked ? "office" : "");
      cell.append(badges);
      cell.setAttribute(
        "aria-label",
        `${MONTH_NAMES[monthIndex]} ${day}, ${year}${isExcluded(dateString) ? ", excluded from working days" : ", working day"}`
      );
      if (!excluded) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "day day-toggle";
        toggle.dataset.date = dateString;
        toggle.setAttribute("aria-pressed", String(marked));
        toggle.setAttribute("aria-label", `${marked ? "Unmark" : "Mark"} ${dateString} as an office day`);
        toggle.append(dateNumber, badges);
        cell.className = "calendar-cell";
        cell.append(toggle);
        toggle.addEventListener("click", async () => {
          if (fileOperationInProgress) {
            setStatus("Finish selecting a data file before marking dates.");
            return;
          }
          data.officeDays = marked
            ? data.officeDays.filter((date) => date !== dateString)
            : [...data.officeDays, dateString].sort();
          const saving = saveData();
          render();
          calendarElement.querySelector(`[data-date="${dateString}"]`).focus();
          if (await saving) setStatus(marked ? "Office day unmarked." : "Office day marked.");
        });
      }
      calendarElement.append(cell);
    }
  }

  function makeEntry(text, meta, actions) {
    const item = document.createElement("li");
    item.className = "entry-item";
    const main = document.createElement("span");
    main.className = "entry-main";
    main.textContent = text;
    const detail = document.createElement("span");
    detail.className = "entry-meta";
    detail.textContent = meta;
    main.append(detail);
    item.append(main, actions);
    return item;
  }

  function renderAbsenceList() {
    absenceList.replaceChildren();
    if (data.absences.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-list";
      empty.textContent = "No leave or approved exception dates added.";
      absenceList.append(empty);
      return;
    }

    [...data.absences]
      .sort((first, second) => first.date.localeCompare(second.date))
      .forEach((absence) => {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${absence.type} on ${absence.date}`);
        remove.addEventListener("click", async () => {
          data.absences = data.absences.filter((item) => item.id !== absence.id);
          const saving = saveData();
          render();
          if (await saving) setStatus("Date removed.");
        });
        absenceList.append(
          makeEntry(
            absence.date,
            absence.type === "leave" ? "Leave" : "Approved exception",
            remove
          )
        );
      });
  }

  function floatingCountForYear(year) {
    return data.holidays.filter((holiday) => {
      return holiday.type === "floating" && holiday.selected && dateParts(holiday.date).year === year;
    }).length;
  }

  function renderHolidayList() {
    holidayList.replaceChildren();
    if (data.holidays.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-list";
      empty.textContent = "No holidays added.";
      holidayList.append(empty);
      return;
    }

    [...data.holidays]
      .sort((first, second) => first.date.localeCompare(second.date))
      .forEach((holiday) => {
        const actions = document.createElement("span");
        actions.className = "entry-actions";

        if (holiday.type === "floating") {
          const selectedLabel = document.createElement("label");
          selectedLabel.className = "check-label";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = Boolean(holiday.selected);
          checkbox.setAttribute("aria-label", `Select ${holiday.name} as a floating holiday`);
          checkbox.addEventListener("change", async () => {
            const year = dateParts(holiday.date).year;
            if (checkbox.checked && floatingCountForYear(year) >= FLOATING_HOLIDAY_LIMIT) {
              checkbox.checked = false;
              setStatus(`Only ${FLOATING_HOLIDAY_LIMIT} floating holidays may be selected for ${year}.`);
              return;
            }
            holiday.selected = checkbox.checked;
            const saving = saveData();
            render();
            if (await saving) {
              setStatus(holiday.selected ? "Floating holiday selected." : "Floating holiday deselected.");
            }
          });
          selectedLabel.append(checkbox, document.createTextNode("Selected"));
          actions.append(selectedLabel);
        }

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${holiday.name} on ${holiday.date}`);
        remove.addEventListener("click", async () => {
          data.holidays = data.holidays.filter((item) => item.id !== holiday.id);
          const saving = saveData();
          render();
          if (await saving) setStatus("Holiday removed.");
        });
        actions.append(remove);

        const meta = holiday.type === "public"
          ? "Public holiday"
          : `Floating holiday · ${holiday.selected ? "selected" : "not selected"}`;
        holidayList.append(makeEntry(`${holiday.date} · ${holiday.name}`, meta, actions));
      });
  }

  function renderSummary(year, monthIndex) {
    const stats = monthStats(year, monthIndex);
    requiredDaysOutput.textContent = String(stats.requiredOfficeDays);
    targetDescription.textContent = `60% of ${stats.adjustedWorkingDays} days, rounded up`;
    attendancePercentageOutput.textContent = stats.adjustedWorkingDays === 0
      ? "—"
      : `${((stats.requiredOfficeDays / stats.adjustedWorkingDays) * 100).toFixed(2)}%`;
    attendanceDescription.textContent = stats.adjustedWorkingDays === 0
      ? "No adjusted working days this month"
      : `${stats.requiredOfficeDays} of ${stats.adjustedWorkingDays} adjusted working days`;
    workingDaysOutput.textContent = String(stats.adjustedWorkingDays);
    excludedDaysOutput.textContent = String(stats.excludedWeekdays);
    markedDaysOutput.textContent = String(stats.markedOfficeDays);
    const remaining = Math.max(0, stats.requiredOfficeDays - stats.markedOfficeDays);
    remainingDaysOutput.textContent = String(remaining);
    markedDescription.textContent = remaining > 0
      ? `${remaining} more office days needed for the monthly target`
      : "Monthly target met";
    markedPercentageOutput.textContent = stats.adjustedWorkingDays === 0
      ? "—"
      : `${((stats.markedOfficeDays / stats.adjustedWorkingDays) * 100).toFixed(2)}%`;
  }

  function render() {
    const { year, monthIndex } = selectedMonth();
    if (!Number.isInteger(year) || !isRetainedYear(year) ||
        !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
      const previousYear = new Date().getFullYear() - 1;
      const currentYear = previousYear + 1;
      setStatus(`Enter ${previousYear} or ${currentYear} and choose a month.`);
      return;
    }
    if (dataLoaded) {
      renderSummary(year, monthIndex);
      renderCalendar(year, monthIndex);
      renderAbsenceList();
      renderHolidayList();
    }
    updateFileControls();
  }

  function initializeMonths() {
    MONTH_NAMES.forEach((month, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = month;
      monthInput.append(option);
    });
    const now = new Date();
    const currentYear = now.getFullYear();
    const previousYear = currentYear - 1;
    monthInput.value = String(now.getMonth());
    yearInput.min = String(previousYear);
    yearInput.max = String(currentYear);
    yearInput.value = String(currentYear);
    [absenceDateInput, holidayDateInput].forEach((input) => {
      input.min = `${previousYear}-01-01`;
      input.max = `${currentYear}-12-31`;
    });
  }

  monthInput.addEventListener("change", () => {
    setStatus();
    render();
  });
  yearInput.addEventListener("input", () => {
    setStatus();
    render();
  });

  absenceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const date = absenceDateInput.value;
    if (!isRetainedDate(date)) {
      setStatus("Choose a date in the current or previous year.");
      return;
    }
    const type = absenceTypeInput.value;
    if (!["leave", "exception"].includes(type)) {
      setStatus("Choose leave or an approved exception.");
      return;
    }
    if (data.absences.some((absence) => absence.date === date && absence.type === type)) {
      setStatus("That date and type are already listed.");
      return;
    }
    data.absences.push({ id: makeId(), date, type });
    const saving = saveData();
    absenceForm.reset();
    render();
    if (await saving) setStatus("Date added and excluded from the working-day calculation.");
  });

  holidayForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const date = holidayDateInput.value;
    const name = holidayNameInput.value.trim();
    const type = holidayTypeInput.value;
    if (!isRetainedDate(date) || !name) {
      setStatus("Enter a holiday name and choose a date in the current or previous year.");
      return;
    }
    if (!["public", "floating"].includes(type)) {
      setStatus("Choose a public or floating holiday.");
      return;
    }
    if (data.holidays.some((holiday) => holiday.date === date && holiday.name.toLowerCase() === name.toLowerCase())) {
      setStatus("That holiday is already listed.");
      return;
    }
    const selected = type === "public" || floatingCountForYear(dateParts(date).year) < FLOATING_HOLIDAY_LIMIT;
    data.holidays.push({ id: makeId(), date, name, type, selected });
    const saving = saveData();
    holidayForm.reset();
    render();
    if (await saving) {
      setStatus(
        type === "floating" && !selected
          ? `Holiday added but not selected; the two floating holidays for ${dateParts(date).year} are already used.`
          : "Holiday added."
      );
    }
  });

  reloadFileButton.addEventListener("click", () => loadData());
  saveFileButton.addEventListener("click", () => saveData());
  window.addEventListener("beforeunload", (event) => {
    if (dirty || pendingSaves > 0) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  initializeMonths();
  render();
  loadData();
})();
