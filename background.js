const POCKET_API_INTERVAL = 1000;
const POCKET_BATCH_FETCH = 100;
const POCKET_FOLDER_TITLE = 'Pocket Bookmarks';

let state = {
  consumerKey: '76771-4e0cd38c1450c66a5ef1ca02',
	accessToken: null,
	username: '',
  pocketFolderId: null
};

(async function init() {
  let storedData = await browser.storage.local.get('state');
  if (storedData && storedData.state) {
    state = storedData.state;
  }

  // Authenticate if necessary
  let authenticated = false;
  if (!state.accessToken) {
    authenticated = await authenticate();
  }
  else {
    authenticated = true;
  }

  if (!state.pocketFolderId) {
    state.pocketFolderId = await initBookmarks();
  }

  if (authenticated) {
    syncAll();
  }
})();

async function initBookmarks() {
  let subtree = (await browser.bookmarks.getSubTree("unfiled_____"))[0];
  let node = subtree.children.reduce((pf, next) => next.title == POCKET_FOLDER_TITLE, false);

  if (!node) {
    node = await browser.bookmarks.create({
      title: POCKET_FOLDER_TITLE
    });
  }

  return node.id;
}

async function syncAll() {
  let count = POCKET_BATCH_FETCH;
  let offset = 0;
  (async function nextBatch() {
    let results = await pocketGet({
      state: "all",
      detailType: "simple",
      count: count,
      offset: offset
    });

    let keys = Object.keys(results.list);
    let length = keys.length;

    keys.forEach(k => {
      bookmarkIfNeeded(results.list[k]);
    });

    if (length > 0) {
      offset += length;
      setTimeout(() => {
        nextBatch();
      }, POCKET_API_INTERVAL);
    }
    else {
      console.log('Sync complete!', offset)
    }
  })();
}

async function bookmarkIfNeeded(result) {
  let bookmarks = await browser.bookmarks.search(result.given_url);
  if (bookmarks.length == 0) {
    let node = await browser.bookmarks.create({
      title: result.given_title,
      url: result.given_url,
      parentId: state.pocketFolderId
    });
  }
}

async function pocketGet(params) {
  params.consumer_key = state.consumerKey;
  params.access_token = state.accessToken;
  let getURL = 'https://getpocket.com/v3/get';
  let resp = await fetch(getURL, {
		method: 'POST',
		headers: {
      'Content-Type': 'application/json; charset=UTF8',
      'X-Accept': 'application/json'
		},
		body: JSON.stringify(params)
	});
  return await resp.json();
}

async function pocketSearch(terms) {
  return await pocketGet({
    search: terms,
    count: 10
  });
}

async function authenticate() {
  try {
    let reqAPIURL = 'https://getpocket.com/v3/oauth/request';
    let redirectURL = browser.identity.getRedirectURL();

    let tokenResponse = await fetch(reqAPIURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF8',
        'X-Accept': 'application/json'
      },
      body: JSON.stringify({
        consumer_key: state.consumerKey,
        redirect_uri: redirectURL
      })
    });
    let token = await tokenResponse.json();

    let authURL = 'https://getpocket.com/auth/authorize'
      + '?request_token=' + token.code
      + '&redirect_uri=' + encodeURIComponent(redirectURL);

    let result = await browser.identity.launchWebAuthFlow({
      interactive: true,
      url: authURL
    });

    let authAPIURL = 'https://getpocket.com/v3/oauth/authorize';
    let accessResponse = await fetch(authAPIURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF8',
        'X-Accept': 'application/json'
      },
      body: JSON.stringify({
        consumer_key: state.consumerKey,
        code: token.code
      })
    });
    let access = await accessResponse.json();

    state.accessToken = access.access_token;
    state.username = access.username;
    saveState();
  }
  catch (ex) {
    return false;
  }
  return true;
}

async function saveState() {
  await browser.storage.local.set({state})
}

// Provide help text to the user.
browser.omnibox.setDefaultSuggestion({
  description: 'Search your Pocket articles!'
});

// Update the suggestions whenever the input is changed.
browser.omnibox.onInputChanged.addListener(async function(text, addSuggestions) {
  pocketSearch(text)
    .then((resp) => resp.list)
    .then(createSuggestionsFromList)
    .then(addSuggestions);
});

// Open the page based on how the user clicks on a suggestion.
browser.omnibox.onInputEntered.addListener((text, disposition) => {
  let url = text;
  switch (disposition) {
    case "currentTab":
      browser.tabs.update({url});
      break;
    case "newForegroundTab":
      browser.tabs.create({url});
      break;
    case "newBackgroundTab":
      browser.tabs.create({url, active: false});
      break;
  }
});

async function createSuggestionsFromList(list) {
  let suggestions = [];
  let suggestionsOnEmptyResults = [{
    content: 'about:blank',
    description: "no results found"
  }];

  if (!Object.keys(list).length) {
    return resolve(suggestionsOnEmptyResults);
  }

  Object.keys(list).forEach((item) => {
    let details = list[item];
    suggestions.push({
      content: details.resolved_url,
      description: details.resolved_title
    });
  });

  return suggestions;
}
