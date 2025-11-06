import os
import re
from supabase import create_client, Client
import mlx_clip
from dotenv import load_dotenv
import psycopg2
import math

# Load environment variables from .env file
# (pip install python-dotenv if not already installed)
load_dotenv()

# Set your Supabase credentials here
SUPABASE_URL = os.getenv("API_URL")
SUPABASE_KEY = os.getenv("ANON_KEY")
# Prefer SUPABASE_DB_URL, fallback to legacy DB_URL
SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL") or os.getenv("DB_URL")

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Initialize the mlx_clip model
clip = mlx_clip.mlx_clip("mlx_model")

# Directory containing images
IMAGE_DIR = "../images/"

# Table name derived from R2_BUCKET when available (fallback to legacy)
R2_BUCKET = os.getenv("R2_BUCKET", "")
def derive_table_name(bucket: str) -> str:
    if not bucket:
        return "image_embeddings_clip"
    sanitized = re.sub(r"[^a-zA-Z0-9]", "_", bucket).lower()
    return f"{sanitized}_embeddings"
TABLE_NAME = derive_table_name(R2_BUCKET)

# --- Create table if it doesn't exist using psycopg2 ---
# Get embedding dimension by encoding a sample image (first image in directory)
def get_embedding_dim():
    for filename in os.listdir(IMAGE_DIR):
        if filename.lower().endswith((".jpg", ".jpeg", ".png")):
            file_path = os.path.join(IMAGE_DIR, filename)
            embedding = clip.image_encoder(file_path)
            if hasattr(embedding, 'shape'):
                return embedding.shape[0]
            return len(embedding)
    raise Exception("No image files found in directory.")

embedding_dim = get_embedding_dim()

# SQL to create table if not exists
create_table_sql = f'''
create extension if not exists vector;
create table if not exists {TABLE_NAME} (
    id serial primary key,
    file_name text,
    embedding vector({embedding_dim}),
    created_at timestamp default now()
);
'''

# Use Supabase SQL API to execute the statement
try:
    conn = psycopg2.connect(SUPABASE_DB_URL)
    cur = conn.cursor()
    cur.execute(create_table_sql)
    conn.commit()
    cur.close()
    conn.close()
    print(f"Ensured table '{TABLE_NAME}' exists.")
except Exception as e:
    print(f"Could not create table: {e}")

# --- Insert embeddings as before ---
count = 0
for filename in os.listdir(IMAGE_DIR):
    if filename.lower().endswith((".jpg", ".jpeg", ".png")):
        file_path = os.path.join(IMAGE_DIR, filename)
        try:
            # Encode the image and get the embedding
            embedding = clip.image_encoder(file_path)
            # Convert embedding to list if needed
            embedding_list = embedding.tolist() if hasattr(embedding, 'tolist') else list(embedding)
            # Check for NaN/Inf
            if any((isinstance(x, float) and (math.isnan(x) or math.isinf(x))) for x in embedding_list):
                continue
            # Prepare data for insertion
            data = {
                "file_name": filename,
                "embedding": embedding_list,
            }
            # Insert into Supabase
            supabase.table(TABLE_NAME).insert(data).execute()
            count += 1
            if count % 10 == 0:
                print('.', end='', flush=True)
        except Exception as e:
            pass
print()  # Print newline at the end 