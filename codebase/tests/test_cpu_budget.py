from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, get_ident
import pytest
from hdr_finisher.cpu_budget import CpuExecutor, logical_cpus


def test_nested_cpu_jobs_complete_in_order_without_deadlock():
    def outer(value):
        with CpuExecutor() as nested:
            return list(nested.map(lambda part: value + part, range(4)))
    with ThreadPoolExecutor(max_workers=1) as caller:
        def run():
            with CpuExecutor() as pool:
                return list(pool.map(outer, range(logical_cpus() * 2)))
        result = caller.submit(run).result(timeout=10)
    assert result == [[value+part for part in range(4)] for value in range(logical_cpus()*2)]


def test_cpu_jobs_overlap_and_propagate_failure():
    count = min(4, logical_cpus())
    barrier = Barrier(count)
    def run(value):
        barrier.wait(timeout=3)
        return get_ident()
    with CpuExecutor() as pool:
        assert len(set(pool.map(run, range(count)))) == count
        def fail(value):
            raise ValueError("failed band")
        with pytest.raises(ValueError, match="failed band"):
            list(pool.map(fail, range(1)))
