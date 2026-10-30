# PostgreSQL TLS certificate

`supabase-ca.crt` is the public Supabase root CA certificate downloaded from this project's database settings. It is not a private key or database password. The connection check uses it with certificate and hostname verification enabled.

`DATABASE_SSL_CA_FILE` points to this certificate; `DATABASE_URL` contains the secret connection string and belongs only in environment secrets. These variables prepare the PostgreSQL connection for the shared-storage implementation; adding them does not migrate the existing file-based storage.
