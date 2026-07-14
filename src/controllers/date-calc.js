// Options array (pure JS objects)
const DURATION_OPTIONS = [
  { value: "1 day",   label: "1 day" },
  { value: "3 day",   label: "3 days" },
  { value: "5 day",   label: "5 days" },
  { value: "7 day",   label: "7 days" },
  { value: "1 month", label: "1 month" },
  { value: "3 month", label: "3 months" },
  { value: "6 month", label: "6 months" },
  { value: "12 month",label: "12 months" },
];

/**
 * date mein dynamic duration add karega: days/months/years
 * @param {Date} date    - base date
 * @param {string} dur   - "3 day" ya "6 month" format
 * @returns {Date}       - new Date object
 */
function addDuration(date, dur) {
  const [amtStr, unitRaw] = dur.split(' ');
  const amount = parseInt(amtStr, 10);
  const unit = unitRaw.toLowerCase();

  // clone date so original na badle
  const result = new Date(date);

  if (unit.startsWith('day')) {
    result.setDate(result.getDate() + amount);
  } 
  else if (unit.startsWith('month')) {
    result.setMonth(result.getMonth() + amount);
  } 
  else if (unit.startsWith('year')) {
    result.setFullYear(result.getFullYear() + amount);
  } 
  else {
    console.warn(`Unsupported unit: ${unitRaw}`);
  }

  return result;
}

// --- Usage Example ---
const today = new Date();
console.log("Today:", today.toISOString().slice(0,10));

DURATION_OPTIONS.forEach(opt => {
  const newDate = addDuration(today, opt.value);
  console.log(`${opt.label} बाद →`, newDate.toISOString().slice(0,10));
});
