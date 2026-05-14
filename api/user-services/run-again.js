/* ================================================================
   POST /api/user-services/run-again
   Re-triggers the workflow using existing parameters & credentials.
   Delegates to /api/user-services/activate.
   ================================================================ */
const activateHandler = require("./activate");

module.exports = activateHandler;  // Same logic — activate handles "run again"
