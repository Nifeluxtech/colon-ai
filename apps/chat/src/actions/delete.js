/* Colon AI · deleting a conversation. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { refreshConvs } from '../components/sidebar.js';
import { S, data } from '../core/state.js';

var C = Colon;

function deleteConv(c, after) {
  C.confirm({ title: 'Delete this conversation?', body: '“' + c.title
    + '” and its messages will be permanently deleted. This can’t be undone.', confirm: 'Delete', danger: true }).then(
    function (ok) {
    if (!ok) return;
    data.deleteConversation(c.id).then(function () {
      C.toast('Conversation deleted.'); refreshConvs(); if (after) after();
      if (S.current && S.current.id === c.id) { S.current = null; C.go('/'); }
    }).catch(function (e) { C.toast(e.message, 'bad'); });
  });
}

export { deleteConv };
