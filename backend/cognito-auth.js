/* =============================================
   AquaSense Admin Portal – Cognito Auth Module
   ============================================= */

const ADMIN_CONFIG = {
  region: 'ap-south-1',
  userPoolId: 'ap-south-1_XXXXXXXXX', // TO BE FILLED FROM TERRAFORM OUTPUT
  clientId: 'XXXXXXXXXXXXXXXXXXXXXXXXXX' // TO BE FILLED FROM TERRAFORM OUTPUT
};

const poolData = {
  UserPoolId: ADMIN_CONFIG.userPoolId,
  ClientId:   ADMIN_CONFIG.clientId
};

const adminUserPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);

let ADMIN_AUTH = {
  token: localStorage.getItem('aqua_admin_token'),
  user: null
};

function showAdminLogin() {
  document.getElementById('admin-login-overlay').classList.remove('hidden');
}

function hideAdminLogin() {
  document.getElementById('admin-login-overlay').classList.add('hidden');
}

async function handleAdminLogin(email, password) {
  const btn = document.getElementById('btn-admin-login');
  const err = document.getElementById('admin-login-error');
  btn.textContent = 'Verifying Admin...';
  btn.disabled = true;
  err.textContent = '';

  const authenticationData = { Username: email, Password: password };
  const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails(authenticationData);
  const userData = { Username: email, Pool: adminUserPool };
  const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

  return new Promise((resolve, reject) => {
    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: (result) => {
        const idToken = result.getIdToken().getJwtToken();
        const payload = result.getIdToken().decodePayload();
        
        // Verify group
        const groups = payload['cognito:groups'] || [];
        if (!groups.includes('admin-ops')) {
          err.textContent = 'Access Denied: You do not have admin permissions.';
          cognitoUser.signOut();
          btn.textContent = 'Sign In';
          btn.disabled = false;
          return;
        }

        ADMIN_AUTH.token = idToken;
        ADMIN_AUTH.user = { name: payload.name || email, email: email };
        localStorage.setItem('aqua_admin_token', idToken);
        
        hideAdminLogin();
        btn.textContent = 'Sign In';
        btn.disabled = false;
        resolve(true);
      },
      onFailure: (e) => {
        err.textContent = e.message || 'Login failed';
        btn.textContent = 'Sign In';
        btn.disabled = false;
        resolve(false);
      }
    });
  });
}

function handleAdminSignOut() {
  const cognitoUser = adminUserPool.getCurrentUser();
  if (cognitoUser) cognitoUser.signOut();
  ADMIN_AUTH = { token: null, user: null };
  localStorage.removeItem('aqua_admin_token');
  location.reload(); // Refresh to clear all data
}

async function checkAdminAuth() {
  const cognitoUser = adminUserPool.getCurrentUser();
  if (!cognitoUser) return false;

  return new Promise((resolve) => {
    cognitoUser.getSession((err, session) => {
      if (err || !session.isValid()) {
        resolve(false);
        return;
      }
      
      const idToken = session.getIdToken().getJwtToken();
      const payload = session.getIdToken().decodePayload();
      
      const groups = payload['cognito:groups'] || [];
      if (!groups.includes('admin-ops')) {
        resolve(false);
        return;
      }

      ADMIN_AUTH.token = idToken;
      ADMIN_AUTH.user = { name: payload.name || payload.email, email: payload.email };
      localStorage.setItem('aqua_admin_token', idToken);
      resolve(true);
    });
  });
}
