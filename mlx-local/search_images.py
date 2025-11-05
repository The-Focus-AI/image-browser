import os
import sys
import psycopg2
import mlx_clip
from dotenv import load_dotenv
import numpy as np

# Load environment variables
load_dotenv()
SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")

# Initialize the mlx_clip model
clip = mlx_clip.mlx_clip("mlx_model")

# Get the query from command line
if len(sys.argv) < 2:
    print("Usage: python search_images.py 'your query here'")
    sys.exit(1)
query = sys.argv[1]

# Encode the query
text_embedding = clip.text_encoder(query)
embedding_list = text_embedding.tolist() if hasattr(text_embedding, 'tolist') else list(text_embedding)

# Connect to the database and perform similarity search
try:
    conn = psycopg2.connect(SUPABASE_DB_URL)
    cur = conn.cursor()
    # Use cosine distance for similarity
    sql = """
        SELECT file_name, embedding <#> %s::vector AS distance
        FROM image_embeddings
        ORDER BY distance ASC
        LIMIT 10;
    """
    cur.execute(sql, (embedding_list,))
    results = cur.fetchall()
    for file_name, distance in results:
        print(file_name)
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error during search: {e}") 