// Plays the Colon AI intro once per browser session, then reveals the page.
(function () {
  if (sessionStorage.getItem('colonIntroSeen')) return;
  sessionStorage.setItem('colonIntroSeen', '1');
  var el = document.createElement('div');
  el.className = 'colon-intro';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML =
    '<svg viewBox="-200 -160 400 260">' +
    '<defs><linearGradient id="ci-fire" x1="0" y1="1" x2="0" y2="0">' +
    ('<stop offset="0" stop-color="#3457C7"/><stop offset=".6" stop-color="#4169E1"/><stop offset="1" '
      + 'stop-color="#38BDF8"/></linearGradient>') +
    ('<linearGradient id="ci-core" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FF6A1A"/><stop '
      + 'offset="1" stop-color="#FFD166"/></linearGradient></defs>') +
    '<ellipse class="ci-ripple" cx="0" cy="0" rx="18" ry="5"/>' +
    '<ellipse class="ci-ripple r2" cx="0" cy="0" rx="18" ry="5"/>' +
    '<path class="ci-drop" d="M0,-30 C10,-14 16,-6 16,4 a16,16 0 0 1 -32,0 C-16,-6 -10,-14 0,-30z"/>' +
    ('<path class="ci-flame" d="M0,-70 C22,-44 30,-26 22,-8 C18,2 8,6 0,6 C-8,6 -18,2 -22,-8 C-30,-26 -12,-36 '
      + '-6,-52 C-2,-40 4,-36 8,-34 C10,-46 6,-58 0,-70z"/>') +
    ('<path class="ci-flame ci-core" d="M0,-34 C9,-24 12,-17 9,-10 C7,-4 3,-2 0,-2 C-3,-2 -7,-4 -9,-10 C-11,-17 '
      + '-5,-21 -3,-27 C-1,-22 1,-20 3,-19 C4,-25 3,-30 0,-34z"/>') +
    '<text class="ci-word" x="0" y="80" text-anchor="middle">COLON</text>' +
    '</svg>';
  document.documentElement.appendChild(el);
  setTimeout(function () { el.classList.add('done'); }, 3600);
  setTimeout(function () { el.remove(); }, 4500);
  el.addEventListener('click', function () { el.classList.add('done'); setTimeout(function () { el.remove(); }, 900);
    });
})();
