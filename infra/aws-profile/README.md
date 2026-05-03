# AWS Profile Setup for AquaSense

This folder is a local helper for your AWS profile configuration.

## Recommended setup

1. Open PowerShell.
2. Run the AWS CLI configure command for a named profile:

```powershell
aws configure --profile aquasense
```

3. Enter your AWS credentials when prompted:
- AWS Access Key ID
- AWS Secret Access Key
- Default region name: `ap-south-1`
- Default output format: `json`

4. Use the profile in PowerShell before running Terraform:

```powershell
$env:AWS_PROFILE = "aquasense"
$env:AWS_REGION  = "ap-south-1"
```

5. Then change directory to the Terraform folder and run Terraform:

```powershell
cd ..\terraform
terraform init
terraform plan
terraform apply
```

## Optional local credential file

If you want to keep a local credentials file in this folder, copy `credentials.example` to `credentials` and fill in your values.

> Do not commit the `credentials` file. This folder includes a `.gitignore` entry to help keep it safe.

## Notes

- The AWS CLI stores profiles in `%USERPROFILE%\.aws\credentials` and `%USERPROFILE%\.aws\config`.
- The `AWS_PROFILE` environment variable tells Terraform which profile to use.
- Never paste your real secret values into committed repository files.
