const express = require('express');
const app = express();
const request = require('request-promise-native');
const NodeCache = require('node-cache');
const session = require('express-session');
const hubspot = require('@hubspot/api-client');
const cors = require('cors');

const refreshTokenStore = {};
const accessTokenCache = new NodeCache({ deleteOnExpire: true });

app.use(cors({ origin: 'http://localhost:3000',
credentials: true,}));

const CLIENT_ID = '94a8188f-5484-474f-b8a4-5eb80fc5d5db';
const CLIENT_SECRET = 'c7f173fa-411e-480a-b5e9-d90a0c01a385';

PORT = 5001;

// Scopes for this app will default to `crm.objects.contacts.read`
// To request others, set the SCOPE environment variable instead
const SCOPES = ['crm.objects.deals.read'];

if (process.env.SCOPE) {
    SCOPES = (process.env.SCOPE.split(/ |, ?|%20/)).join(' ');
}

// On successful install, users will be redirected to /oauth-callback
const REDIRECT_URI = `http://localhost:${PORT}/oauth-callback`;

//===========================================================================//

// Use a session to keep track of client ID
app.use(session({
  secret: Math.random().toString(36).substring(2),
  resave: false,
  saveUninitialized: true
}));
 
//================================//
//   Running the OAuth 2.0 Flow   //
//================================//

// Step 1
// Build the authorization URL to redirect a user
// to when they choose to install the app
const authUrl =
  'https://app.hubspot.com/oauth/authorize' +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` + // app's client ID
  `&scope=${encodeURIComponent(SCOPES)}` + // scopes being requested by the app
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`; // where to send the user after the consent page

// Redirect the user from the installation page to
// the authorization URL
app.get('/install', (req, res) => {
  console.log('');
  console.log('=== Initiating OAuth 2.0 flow with HubSpot ===');
  console.log('');
  console.log("===> Step 1: Redirecting user to your app's OAuth URL");

  // Generate a random state value
  const state = Math.random().toString(36).substring(2);

  // Store the state value in the session
  req.session.state = state;

  // Build the authorization URL with the state parameter
  const authUrl =
    'https://app.hubspot.com/oauth/authorize' +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${encodeURIComponent(state)}`;

  // Redirect the user to the authorization URL
  res.redirect(authUrl);
  console.log('===> Step 2: User is being prompted for consent by HubSpot');
});


// Step 2
// The user is prompted to give the app access to the requested
// resources. This is all done by HubSpot, so no work is necessary
// on the app's end

// Step 3
// Receive the authorization code from the OAuth 2.0 Server,
// and process it based on the query parameters that are passed
app.get('/oauth-callback', async (req, res) => {
  console.log('===> Step 3: Handling the request sent by the server');

  // Received a user authorization code, so now combine that with the other
  // required values and exchange both for an access token and a refresh token
  if (req.query.code) {
    console.log('       > Received an authorization token');

    const authCodeProof = {
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code: req.query.code
    };

    // Step 4
    // Exchange the authorization code for an access token and refresh token
    console.log('===> Step 4: Exchanging authorization code for an access token and refresh token');
    const token = await exchangeForTokens(req.sessionID, authCodeProof);
    if (token.message) {
      return res.redirect(`/error?msg=${token.message}`);
    }

    // Once the tokens have been retrieved, use them to make a query
    // to the HubSpot API
    res.redirect(`/`);
  }
});

//==========================================//
//   Exchanging Proof for an Access Token   //
//==========================================//

const exchangeForTokens = async (userId, exchangeProof) => {
  try {
    const responseBody = await request.post('https://api.hubapi.com/oauth/v1/token', {
      form: exchangeProof
    });
    // Usually, this token data should be persisted in a database and associated with
    // a user identity.
    const tokens = JSON.parse(responseBody);
    refreshTokenStore[userId] = tokens.refresh_token;
    accessTokenCache.set(userId, tokens.access_token, Math.round(tokens.expires_in * 0.75));

    console.log('       > Received an access token and refresh token');
    return tokens.access_token;
  } catch (e) {
    console.error(`       > Error exchanging ${exchangeProof.grant_type} for access token`);
    return JSON.parse(e.response.body);
  }
};

const refreshAccessToken = async (userId) => {
  const refreshTokenProof = {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    refresh_token: refreshTokenStore[userId]
  };
  return await exchangeForTokens(userId, refreshTokenProof);
};

const getAccessToken = async (userId) => {
  // If the access token has expired, retrieve
  // a new one using the refresh token
  if (!accessTokenCache.get(userId)) {
    console.log('Refreshing expired access token');
    await refreshAccessToken(userId);
  }
  return accessTokenCache.get(userId);
};

const isAuthorized = (userId) => {
  return refreshTokenStore[userId] ? true : false;
};

//====================================================//
//   Using an Access Token to Query the HubSpot API   //
//====================================================//

const getContacts = async (accessToken) => {
  console.log('');
  console.log('=== Retrieving contacts from HubSpot using the access token ===');
  try {
    const headers1 = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    console.log('===> Replace the following request.get() to test other API calls');
    console.log('===> request.get(\'https://api.hubapi.com/contacts/v1/lists/all/contacts/all?count=1\')');
    const result = await request.get('https://api.hubapi.com/contacts/v1/lists/all/contacts/all', {
      headers: headers1
    });
    return JSON.parse(result).contacts;
  } catch (e) {
    console.error('  > Unable to retrieve contacts');
    return JSON.parse(e.response.body);
  }
};

const getPipelinestage = async (accessToken) => {

try {
   // Get the access token dynamically
   // Pass the access token to the hubspotClient
   const objectType = "Deals";
const pipelineId = "default";
   const headers2 = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
   const apiResponse = await request.get(`https://api.hubapi.com/crm/v3/pipelines/${objectType}/${pipelineId}/stages`, {
  headers: headers2
}); return JSON.stringify(apiResponse, null, 2).stages;
}
catch (e) {
  e.message === 'HTTP request failed'
    ? console.error(JSON.stringify(e.response, null, 2))
    : console.error(e);
}
};



app.get('/pipelinestage', async (req, res) => {
    try {
      const accessToken = await getAccessToken(req.sessionID); // Get the access token dynamically
      const hubspotClient = new hubspot.Client({ accessToken });
      const objectType = "deals";
      const pipelineId = "27911521";
  
      const apiResponse = await hubspotClient.crm.pipelines.pipelineStagesApi.getAll(objectType, pipelineId);
  
      const pipelineStages = apiResponse.results.map((stage) => {
        return {
          label: stage.label,
          displayOrder: stage.displayOrder
        };
      });
  
      res.json(pipelineStages);
    } catch (e) {
      e.message === 'HTTP request failed'
        ? console.error(JSON.stringify(e.response, null, 2))
        : console.error(e);
    }
  });

//properties with names and descriptions
app.get('/properties', async (req, res) => {
    try {
      const accessToken = await getAccessToken(req.sessionID); // Get the access token dynamically
      const hubspotClient = new hubspot.Client({ accessToken });
      const objectType = "deals";
      const archived = false;
      const properties = undefined;
  
      // Retrieve the properties for the specified stage
      const apiResponse = await hubspotClient.crm.properties.coreApi.getAll(objectType, archived, properties);
      // Extract the relevant fields from the stage properties
      
      const propertyNames = apiResponse.results.map((property) => {
        return {
            name: property.name,
            description: property.description
            
        };
        });
      
      res.json(propertyNames, null, 2);
    } catch (e) {
        e.message === 'HTTP request failed'
        ? console.error(JSON.stringify(e.response, null, 2))
        : console.error(e)
    }
});


  

app.get('/contacts', async (req, res) => {
    try {
      if (isAuthorized(req.sessionID)) {
        const accessToken = await getAccessToken(req.sessionID);
        const contacts = await getContacts(accessToken);
        res.json(contacts);
      } else {
        res.status(401).json({ error: 'Unauthorized' });
      }
    } catch (error) {
      console.error('Error retrieving contacts:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
//========================================//
//   Displaying information to the user   //
//========================================//

const displayContacts = (res, contacts) => {
    if (contacts.status === 'error') {
      res.write(`<p>Unable to retrieve contacts! Error Message: ${contacts.message}</p>`);
      return;
    }
    res.write('<h4>Contact List:</h4>');
    contacts.forEach((contact) => {
      const firstname = contact.properties.firstname ? contact.properties.firstname.value : 'N/A';
      const lastname = contact.properties.lastname ? contact.properties.lastname.value : 'N/A';
      res.write(`<p>Contact name: ${firstname} ${lastname}</p>`);
    });
  };

app.get('/', async (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.write(`<h2>HubSpot OAuth 2.0 Quickstart App</h2>`);

  if (isAuthorized(req.sessionID)) {
    const accessToken = await getAccessToken(req.sessionID);
    const contacts = await getContacts(accessToken);
    res.write(`<h4>Access token: ${accessToken}</h4>`);
    displayContacts(res, contacts);
  } else {
    res.write(`<a href="/install"><h3>Install the app</h3></a>`);
  }
  
  res.end();
});

app.get('/error', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.write(`<h4>Error: ${req.query.msg}</h4>`);
  res.end();
});


app.listen(PORT, () => console.log(`Server started on Port ${PORT}`));