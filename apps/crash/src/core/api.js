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
  bets: function (limit) { return C.api('/crash/bets?limit=' + (limit || 50)); },
  // v0.35.0 (step 3): rounds typed in by hand, or a CSV export (multiplier[,time][,round_id]).
  // Both answer { inserted, duplicates, rejected, errors: [{ index | line, reason }] }.
  addRounds: function (rounds) { return C.api('/crash/rounds', { method: 'POST', body: { source: 'manual',
    rounds: rounds } }); },
  importCsv: function (csv) { return C.api('/crash/rounds/import', { method: 'POST', body: { csv: csv } }); }
};

export { crashApi };
