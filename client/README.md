# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)


Taurus Client Portal – Development Guide
🚀 Running the React App Locally

From the repo root:

cd client
npm install
npm start


This launches the React dev server at:

http://localhost:3000

🔐 Authentication in Local Development

Catalyst authentication does not run when using npm start on localhost.
Because of this, window.portalUser is not available in dev.

To allow local development, the app uses a fallback sandbox user:

Email: paralegal.sandbox@lawfirm.co.za
Name:  Sandbox Paralegal


This is defined in:

client/src/services/portalApi.js
client/src/pages/dashboard/ParalegalDashboard.jsx


When the app runs in production (Catalyst), the real user from Catalyst Auth is used.

🌐 Calling the Catalyst Backend in Dev

When running locally, React lives on:

http://localhost:3000


Your Catalyst backend lives on:

https://taurus-client-portal-889090616.development.catalystserverless.com


To avoid CORS and routing issues, the app automatically switches API endpoints:

In Development (npm start)

API calls go to:

https://taurus-client-portal-889090616.development.catalystserverless.com/server

In Production (Catalyst Hosting)

API calls go to:

/server


This logic lives in:

client/src/services/portalApi.js

🔎 Getting Deals From Zoho Analytics

The backend function getportaldeals is called via:

GET /server/getportaldeals?email={userEmail}


The API returns:

{
  "count": 1,
  "deals": [
    {
      "property_ref_number": "...",
      "created_time": "...",
      "paralegal_name": "...",
      "contact_email": "..."
    }
  ]
}


The dashboard shows:

My Deals

Firm Deals (future)

🧪 Testing the Dashboard Locally

Open:

http://localhost:3000/


You should see:

User: Sandbox Paralegal

Email: paralegal.sandbox@lawfirm.co.za

Deals table populated via live Catalyst API

Use DevTools → Console to check logs:

MY DEALS RESPONSE { ... }

📦 Deployment (Catalyst)

To deploy backend functions:

catalyst deploy functions


To deploy frontend:

cd client
npm run build


Then upload the build/ folder to Catalyst (or use catalyst deploy if configured).

🧩 File Map for Dashboard Feature
client/src/
  services/
    portalApi.js       ← API wrapper + dev/prod routing
  pages/
    dashboard/
      ParalegalDashboard.jsx
      ParalegalDashboard.css
      RoleBasedDashboard.jsx
  App.js               ← Routes (RoleBasedDashboard as /)