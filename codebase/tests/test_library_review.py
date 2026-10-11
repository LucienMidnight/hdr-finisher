from hdr_finisher.library_review import CompareRequest, compare, ReviewPreferences
import pytest


def test_pin_and_navigation_are_backend_commands_and_keep_reference():
    def run(action,selected="a",left=None,step=1):
        return compare(CompareRequest(action=action,paths=["a","b","c"],selected=selected,left=left,step=step))
    assert run("left") == {"enabled":True,"left":"a","right":"b"}
    assert run("move","b","a")["right"] == "c"
    assert run("move","b","a",-1)["right"] == "b"
    assert run("left","b","a")["left"] == "b"
    assert run("right","c","a")["left"] == "a"
    assert not run("off","b","a")["enabled"]


def test_single_item_and_virtual_items_remain_independent():
    result=compare(CompareRequest(action="left",paths=["a|copy|1","a|copy|2"],selected="a|copy|1"))
    assert result["right"] == "a|copy|2"
    assert compare(CompareRequest(action="on",paths=["a"],selected="a"))["right"]=="a"
    with pytest.raises(ValueError): compare(CompareRequest(action="on",paths=[],selected="a"))
    with pytest.raises(ValueError): ReviewPreferences(compare_layout="invalid")
