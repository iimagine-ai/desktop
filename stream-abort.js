// Stream abort controller — manages active fetch streams for graceful cancellation
let activeStreamController = null;

function setActiveStreamController(controller) {
  activeStreamController = controller;
}

function getActiveStreamController() {
  return activeStreamController;
}

function clearActiveStreamController() {
  activeStreamController = null;
}

function abortActiveStream() {
  if (activeStreamController) {
    activeStreamController.abort();
    clearActiveStreamController();
    return true;
  }
  return false;
}

module.exports = {
  setActiveStreamController,
  getActiveStreamController,
  clearActiveStreamController,
  abortActiveStream,
};
