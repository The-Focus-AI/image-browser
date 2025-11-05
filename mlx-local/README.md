# MLX_CLIP 📚🤖

[![GitHub](https://img.shields.io/github/license/harperreed/mlx-clip)](https://github.com/harperreed/mlx-clip/blob/main/LICENSE)

Welcome to the MLX_CLIP repository! 🎉 This repository contains an implementation of the CLIP (Contrastive Language-Image Pre-training) model using the MLX library. CLIP is a powerful model that learns to associate images with their corresponding textual descriptions, enabling various downstream tasks such as image retrieval and zero-shot classification. 🖼️📝

## Features ✨

- Easy-to-use MLX_CLIP model for generating image and text embeddings
- Support for loading pre-trained CLIP weights from Hugging Face
- Efficient conversion of weights to MLX format for optimal performance
- Seamless integration with the MLX library for accelerated inference on Apple Silicon devices

## Getting Started 🚀

To get started with MLX_CLIP, follow these steps:

1. Clone the repository:
   ```
   git clone https://github.com/harperreed/mlx_clip.git
   ```

2. Install the required dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Load the pre-trained CLIP model:
   ```python
   from mlx_clip import mlx_clip

   model_dir = "path/to/pretrained/model"
   clip = mlx_clip(model_dir)
   ```

4. Use the CLIP model for generating image and text embeddings:
   ```python
   image_path = "path/to/image.jpg"
   image_embedding = clip.image_encoder(image_path)

   text = "A description of the image"
   text_embedding = clip.text_encoder(text)
   ```

## Examples 💡

Check out the `example.py` file for a simple example of how to use MLX_CLIP to generate image and text embeddings.

## Model Conversion 🔄

MLX_CLIP provides a convenient utility to convert pre-trained CLIP weights from the Hugging Face repository to the MLX format. To convert weights, use the `convert_weights` function from `mlx_clip.convert`:

```python
from mlx_clip.convert import convert_weights

hf_repo = "openai/clip-vit-base-patch32"
mlx_path = "path/to/save/converted/model"
convert_weights(hf_repo, mlx_path)
```

## Contributing 🤝

Contributions to MLX_CLIP are welcome! If you encounter any issues, have suggestions for improvements, or want to add new features, please open an issue or submit a pull request. Make sure to follow the existing code style and provide appropriate documentation for your changes.

## License 📜

MLX_CLIP is licensed under the [MIT License](LICENSE).

## Acknowledgments 🙏

MLX_CLIP is heavily based on the [mlx-experiments clip implementation](https://github.com/ml-explore/mlx-examples/tree/main/clip). Special thanks to the MLX team for their incredible work!

## Contact 📞

For any questions or inquiries, feel free to reach out to the project maintainer:

Harper Reed
- Email: harper@modest.com
- GitHub: [harperreed](https://github.com/harperreed)

## Web Image Search App

A simple Flask web server (`app.py`) is included for searching and exploring your image dataset using CLIP embeddings and pgvector in Supabase Postgres.

### Features
- **Search bar**: Enter a text query to find similar images using CLIP embeddings.
- **3x3 grid**: Results are shown in a 3x3 grid, displaying images in their natural size (with a max-height for layout consistency).
- **Image neighbors**: Click any image to see a 3x3 grid of its most similar (nearest neighbor) images.
- **Image source**: Images are loaded from the `assets/` directory.

### Requirements
- Python packages: `Flask`, `psycopg2`, `python-dotenv`, `mlx_clip`, and their dependencies.
- A Supabase Postgres database with the `pgvector` extension enabled and populated with image embeddings.

### Usage
1. Install requirements:
   ```bash
   pip install flask psycopg2-binary python-dotenv
   ```
2. Make sure your `.env` file contains your `SUPABASE_DB_URL`.
3. Run the server:
   ```bash
   python app.py
   ```
4. Open [http://localhost:5000](http://localhost:5000) in your browser.
5. Enter a search query or click an image to explore similar images.

## Embedding Storage and Search Scripts

### encode_and_store.py
This script scans a directory of images, encodes each image using the MLX_CLIP model, and stores the resulting embeddings in a Supabase Postgres database with the `pgvector` extension. Each embedding is stored alongside its file name, enabling efficient vector search and retrieval later.

- **How it works:**
  - Loads your Supabase database credentials from a `.env` file.
  - Connects directly to the database to create the `image_embeddings` table if it doesn't exist.
  - Encodes each image in the `assets/` directory and inserts its embedding and file name into the database.

- **Usage:**
  ```bash
  python encode_and_store.py
  ```

### search_images.py
This script allows you to search for images by text query. It encodes the query using the MLX_CLIP model, then searches the Supabase Postgres database for the most similar image embeddings using vector similarity (via pgvector), and prints the matching file names in order of similarity.

- **How it works:**
  - Loads your Supabase database credentials from a `.env` file.
  - Encodes the provided text query.
  - Performs a vector similarity search in the database and returns the top matches.

- **Usage:**
  ```bash
  python search_images.py "your search query"
  ```

Both scripts rely on Supabase Postgres with the `pgvector` extension for efficient storage and search of image embeddings.

---

Happy coding with MLX_CLIP! 😄💻🚀
