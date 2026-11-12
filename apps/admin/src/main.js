// Colon Admin entry point (boot only). Loads the shared UI kit and the Admin Dashboard as ES modules, then
// starts the dashboard once the page is parsed.
import '../../../packages/ui/js/colon.js';
import './core/router.js';

const NEED = ['icon', 'esc', '$', '$$', 'api', 'toast', 'row', 'hasRole', 'roleName', 'sheet', 'confirm', 'prompt',
  'field', 'bindForm', 'go'];

document.addEventListener('DOMContentLoaded', function () {
  window.colonBooted = true;
  if (!window.colonKitReady(NEED, ['ColonAdmin'])) return;
  window.ColonAdmin.start();
});
