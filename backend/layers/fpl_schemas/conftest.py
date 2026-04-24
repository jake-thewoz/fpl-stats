import sys
from pathlib import Path

# Lambda runtime mounts the layer at /opt/python/; mirror that for tests by
# putting the layer's python/ dir on sys.path.
sys.path.insert(0, str(Path(__file__).parent / "python"))
