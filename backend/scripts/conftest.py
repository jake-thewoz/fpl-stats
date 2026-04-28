import sys
from pathlib import Path

# Mirror the runtime layer mount: tests import xp_v2 / xp_v2_features /
# schemas the same way fit_xp_v2.py does at script-run time.
_THIS_DIR = Path(__file__).parent
_LAYER_PY_DIR = _THIS_DIR.parent / "layers" / "fpl_schemas" / "python"
sys.path.insert(0, str(_LAYER_PY_DIR))
sys.path.insert(0, str(_THIS_DIR))
