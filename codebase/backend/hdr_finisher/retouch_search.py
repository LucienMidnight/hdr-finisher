"""One deterministic proposal stream consumed by CPU and GPU Jacobi search."""
import numpy as np


def proposals(settings, shape, sources, count):
    rng = np.random.Generator(np.random.PCG64(settings.seed))
    initial = sources[rng.integers(len(sources), size=count)]
    phases = []
    for iteration in range(settings.iterations):
        direction = 1 if iteration % 2 == 0 else -1
        turn = [(1 if direction > 0 else 3, None), (2 if direction > 0 else 4, None)]
        turn.append((5, sources[rng.integers(len(sources), size=count)]))
        radius = max(shape)
        while radius >= 1:
            turn.append((6, rng.integers(-radius, radius + 1, size=(count, 2))))
            radius //= 2
        phases.append(turn)
    return initial, phases
