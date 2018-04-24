let state = {
  consumerKey: '76771-4e0cd38c1450c66a5ef1ca02',
	accessToken: null,
	username: ''
};

(async function() {
  let storedData = await browser.storage.local.get('state');
  if (storedData && storedData.state) {
    state = storedData.state;
  }

  // Authenticate if necessary
  if (!state.accessToken) {
    await authenticate();
  }
})();

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
