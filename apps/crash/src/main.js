// Colon JetX entry point (boot only). Loads the shared UI kit and the Crash Predictor as ES modules, then starts
// the app once the page is parsed.
import '../../../packages/ui/js/colon.js';
import './core/router.js';

const NEED = ['icon', 'esc', '$', '$$', 'api', 'toast', 'row', 'confirm', 'field', 'bindForm', 'go'];

document.addEventListener('DOMContentLoaded', function () {
  window.colonBooted = true;
  if (!window.colonKitReady(NEED, ['ColonCrash'])) return;
  window.ColonCrash.start();
});
