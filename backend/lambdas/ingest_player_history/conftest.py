import sys
from pathlib import Path

LAMBDA_DIR = Path(__file__).parent
sys.path.insert(0, str(LAMBDA_DIR))

# The `fpl_schemas` Lambda layer ships on /opt/python at runtime; for local
# pytest runs we put the layer's `python` dir on sys.path the same way.
LAYER_PYTHON_DIR = LAMBDA_DIR.parent.parent / "layers" / "fpl_schemas" / "python"
sys.path.insert(0, str(LAYER_PYTHON_DIR))
