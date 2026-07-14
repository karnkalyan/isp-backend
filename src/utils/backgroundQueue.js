const jobs = [];
let running = false;

function enqueueJob(label, handler) {
  jobs.push({ label, handler });
  setImmediate(runNext);
}

async function runNext() {
  if (running || jobs.length === 0) return;
  running = true;
  const job = jobs.shift();
  try {
    await job.handler();
  } catch (error) {
    console.error(`[backgroundQueue] ${job.label} failed:`, error.message);
  } finally {
    running = false;
    if (jobs.length > 0) setImmediate(runNext);
  }
}

module.exports = { enqueueJob };
