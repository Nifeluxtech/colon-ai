/* Colon JetX · the Crash Predictor API (services/api routes/crash.js) through the shared Colon client. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { tzOffset } from './state.js';

var C = Colon;

var crashApi = {
  dashboard: function () { return C.api('/crash/dashboard?tz_offset=' + tzOffset()); },
  settings: function () { return C.api('/crash/settings'); },
  // body: the changed fields; confirm_real_money: true once the user accepted the real-money warning.
  saveSettings: function (body) { return C.api('/crash/settings', { method: 'PUT', body: body }); },
  rounds: function (limit) { return C.api('/crash/rounds?limit=' + (limit || 50)); },
  bets: function (limit) { return C.api('/crash/bets?limit=' + (limit || 50)); }
};

export { crashApi };
