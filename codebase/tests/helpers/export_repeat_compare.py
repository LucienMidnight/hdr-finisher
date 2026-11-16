"""Gate actual finished inputs; retain decoded-file differences as diagnostics."""
import json
import sys

from delivery_comparison import compare_delivery

result = compare_delivery(*sys.argv[1:])
result.update(result["renderer_agreement"])
print(json.dumps(result))
