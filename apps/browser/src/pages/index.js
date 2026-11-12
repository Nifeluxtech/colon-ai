/* Colon Browser · section pages by route name (rendered by components/chrome.js render()). */

import { bookmarksPage } from './bookmarks.js';
import { downloadsPage } from './downloads.js';
import { helpPage } from './help.js';
import { historyPage } from './history.js';
import { settingsPage } from './settings.js';
import { tabsPage } from './tabs.js';

var PAGES = { tabs: tabsPage, bookmarks: bookmarksPage, history: historyPage, downloads: downloadsPage,
  settings: settingsPage, help: helpPage };

export { PAGES };
