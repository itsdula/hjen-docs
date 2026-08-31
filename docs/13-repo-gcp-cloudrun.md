# `gcp-cloudrun` — a Cloud Run deployment scaffold

This is a small, self-contained **Google Cloud Run** deployment experiment. **Per the founder, it is not part of the project** — a "cloud suggestion" / proving ground, not a component of the product, and the cloud provider is *not* a decided matter. It looks like a starter template ("deploy a container to Cloud Run via GitHub Actions") that was kept around while evaluating options. Treat it as a candidate to **archive/delete**, not a deployment target. (Note: this standalone repo is separate from `hjen-server/infra/gcp`, which is an internal *reference* design for a possible future sovereign/enterprise instance.)

- **Type:** Python (FastAPI) service + Terraform + GitHub Actions
- **Role:** Not part of the product — a discarded cloud experiment

## What the service does

Almost nothing yet. `app.py` is a stub FastAPI app:

```python
app = FastAPI()

@app.get("/")
def hello():
    return {"message": "Hello there!"}

# uvicorn.run(app, host="0.0.0.0", port=8080)
```

The imports (`tempfile`, `UploadFile`, `File`, `Form`) hint it was intended to grow into a file-processing endpoint, but as committed it only returns a hello message. `requirements.txt` and a `Dockerfile` build the container.

## What the Terraform provisions

`terraform/cloudrun.tf` deploys:

- A **Cloud Run service** in `me-central1` (project `hjen-platform`), memory 2Gi, max scale 5.
- An **Artifact Registry** Docker repository.
- Public IAM: `roles/run.invoker` granted to **`allUsers`** — i.e. the service is invokable by anyone on the internet.

It authenticates Terraform with a service-account key file (`../gcp-sa-key.json`) and stores state in a GCS backend.

## CI/CD (GitHub Actions)

`.github/workflows/deploy.yml` runs on **push to any branch** (`branches: ['*']`) and:

1. Serializes the entire GitHub Actions **`vars`** context into `TF_VAR_dynamic_env_vars` and the entire **`secrets`** context into `TF_VAR_dynamic_env_secrets` (via `toJSON(...)`).
2. Authenticates to GCP with `secrets.GCP_SERVICE_ACCOUNT_KEY_FILE`.
3. Builds and pushes the image, then `terraform apply -auto-approve`, then `gcloud run deploy`.

There is a companion `destroy.yml` and a reusable `setup-gcp-authentication` composite action.

## Security notes

This repo is where the system's infrastructure risk concentrates. In short:

- **Public service** — `allUsers` as `run.invoker` means no authentication in front of the service. Harmless while it only says "Hello there!", but the pattern is public-by-default.
- **Whole-secrets injection** — dumping *all* Actions secrets into the service's environment (`toJSON(secrets)`) is over-broad: every secret the repo holds, including the GCP service-account key itself, is passed as a plaintext Cloud Run env var. Secrets should be scoped and, ideally, delivered via Secret Manager (as `hjen-server/infra/gcp` does).
- **Deploy on every branch** — `on: push: branches: ['*']` means any pushed branch triggers a real deploy.
- **Long-lived SA key file** — `credentials = "../gcp-sa-key.json"` relies on a downloaded service-account key rather than Workload Identity Federation. The key file is not committed (confirmed: it is not tracked in git), but the pattern invites a long-lived credential on disk.

These are detailed with remediations in the [security review](#22-security). The contrast with `hjen-server/infra/gcp` (least-privilege, Secret Manager, private VPC, no public bucket) is stark — treat that one as the reference and this one as a scaffold to retire or lock down.
