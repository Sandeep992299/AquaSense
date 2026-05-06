# =====================================================================
# AquaSense – Cognito Module Main
# Two User Pools: aqua-customers (portal) and aqua-admins (backend)
# =====================================================================

# ── Customer User Pool ────────────────────────────────────────────────
resource "aws_cognito_user_pool" "customers" {
  name = "${var.name_prefix}-customers"

  # Sign-in options
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Password policy
  password_policy {
    minimum_length                   = var.password_minimum_length
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  # MFA
  mfa_configuration = var.mfa_configuration

  software_token_mfa_configuration {
    enabled = true
  }

  # Account recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Email verification
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "AquaSense – Your verification code"
    email_message        = "Your AquaSense verification code is {####}"
  }

  # Email configuration (uses Cognito default SES – upgrade to custom SES in prod)
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # User schema (standard + custom attributes)
  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
    string_attribute_constraints {
      min_length = 5
      max_length = 320
    }
  }

  schema {
    name                = "name"
    attribute_data_type = "String"
    required            = true
    mutable             = true
    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    name                     = "meter_id"
    attribute_data_type      = "String"
    required                 = false
    mutable                  = true
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 0
      max_length = 50
    }
  }

  schema {
    name                     = "account_type"
    attribute_data_type      = "String"
    required                 = false
    mutable                  = true
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 0
      max_length = 50
    }
  }

  # Advanced security
  user_pool_add_ons {
    advanced_security_mode = "AUDIT"
  }

  tags = {
    Name      = "${var.name_prefix}-customers-pool"
    Component = "Cognito"
    Portal    = "Customer"
  }
}

# ── Customer Pool Domain ───────────────────────────────────────────────
resource "aws_cognito_user_pool_domain" "customers" {
  domain       = "${var.domain_prefix}-customers"
  user_pool_id = aws_cognito_user_pool.customers.id
}

# ── Customer App Client (Portal Web) ──────────────────────────────────
resource "aws_cognito_user_pool_client" "portal_client" {
  name         = "portal-web-client"
  user_pool_id = aws_cognito_user_pool.customers.id

  # No client secret – browser-based SPA
  generate_secret = false

  # Auth flows enabled
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
  ]

  # Token validity
  access_token_validity  = 1   # hours
  id_token_validity      = 1   # hours
  refresh_token_validity = 30  # days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # Prevent user existence errors leaking
  prevent_user_existence_errors = "ENABLED"

  # OAuth
  allowed_oauth_flows                  = ["code", "implicit"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  callback_urls                        = var.customer_portal_callback_urls
  logout_urls                          = var.customer_portal_callback_urls
  supported_identity_providers         = ["COGNITO"]

  # Read attributes the client can see
  read_attributes = [
    "email", "email_verified", "name",
    "custom:meter_id", "custom:account_type",
  ]

  write_attributes = [
    "email", "name",
    "custom:meter_id", "custom:account_type",
  ]
}

# ── Customer Groups ────────────────────────────────────────────────────
resource "aws_cognito_user_group" "customers" {
  name         = "customers"
  user_pool_id = aws_cognito_user_pool.customers.id
  description  = "Standard residential/commercial customers"
  precedence   = 10
}

resource "aws_cognito_user_group" "premium_customers" {
  name         = "premium-customers"
  user_pool_id = aws_cognito_user_pool.customers.id
  description  = "Premium tier customers with extended data access"
  precedence   = 5
}

# ── Admin User Pool ───────────────────────────────────────────────────
resource "aws_cognito_user_pool" "admins" {
  name = "${var.name_prefix}-admins"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 12  # stricter for admins
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 3
  }

  # Admins must use MFA
  mfa_configuration = "ON"

  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "AquaSense Admin – Verification code"
    email_message        = "Your AquaSense admin verification code: {####}"
  }

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
    string_attribute_constraints {
      min_length = 5
      max_length = 320
    }
  }

  schema {
    name                = "name"
    attribute_data_type = "String"
    required            = true
    mutable             = true
    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    name                     = "department"
    attribute_data_type      = "String"
    required                 = false
    mutable                  = true
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 0
      max_length = 100
    }
  }

  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"  # stricter for admins
  }

  tags = {
    Name      = "${var.name_prefix}-admins-pool"
    Component = "Cognito"
    Portal    = "Admin"
  }
}

# ── Admin Pool Domain ─────────────────────────────────────────────────
resource "aws_cognito_user_pool_domain" "admins" {
  domain       = "${var.domain_prefix}-admins"
  user_pool_id = aws_cognito_user_pool.admins.id
}

# ── Admin App Client (Backend Dashboard) ─────────────────────────────
resource "aws_cognito_user_pool_client" "backend_client" {
  name         = "backend-web-client"
  user_pool_id = aws_cognito_user_pool.admins.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
  ]

  access_token_validity  = 1   # hours
  id_token_validity      = 1   # hours
  refresh_token_validity = 1   # day (tighter for admins)

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"

  allowed_oauth_flows                  = ["code", "implicit"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  callback_urls                        = var.admin_portal_callback_urls
  logout_urls                          = var.admin_portal_callback_urls
  supported_identity_providers         = ["COGNITO"]

  read_attributes = [
    "email", "email_verified", "name",
    "custom:department",
  ]

  write_attributes = [
    "email", "name",
    "custom:department",
  ]
}

# ── Admin Groups ──────────────────────────────────────────────────────
resource "aws_cognito_user_group" "admin_ops" {
  name         = "admin-ops"
  user_pool_id = aws_cognito_user_pool.admins.id
  description  = "Operations staff with full dashboard access"
  precedence   = 1
}

resource "aws_cognito_user_group" "read_only" {
  name         = "read-only"
  user_pool_id = aws_cognito_user_pool.admins.id
  description  = "Read-only dashboard viewers (e.g. auditors)"
  precedence   = 10
}
