const YEASTAR_ERRORS = require("./yeastarErrors");

function parseYeastarResponse(res) {
  if (res.status === "Success") {
    return res;
  }

  // 🔧 FIX: Yeastar uses `errno`
  const code = Number(res.errno || res.code);

  const message =
    YEASTAR_ERRORS[code] || "Unknown Yeastar error";

  const error = new Error(message);
  error.code = code;
  error.raw = res;

  throw error;
}

module.exports = parseYeastarResponse;
