"""Explicit Windows RecycleItem; no permanent-delete fallback is called."""
import ctypes as c
import os
from pathlib import Path
from uuid import UUID


class GUID(c.Structure):
    _fields_=[('a',c.c_uint32),('b',c.c_uint16),('d',c.c_uint16),('e',c.c_ubyte*8)]
    def __init__(self,value): super().__init__();c.memmove(c.byref(self),UUID(value).bytes_le,16)


ITEM=GUID('43826d1e-e718-42ee-bc55-a1e261c37bfe')
TRANSFER=GUID('00adb003-bde9-45c6-8e29-d09f9353e108')
HANDLER=GUID('d5e346a1-f753-4932-b403-4574800e2498')
BIN='::{645FF040-5081-101B-9F08-00AA002F954E}'


def check(hr):
    if hr<0: raise OSError(f'Windows Recycle Bin could not complete this item (0x{hr & 0xffffffff:08X}). Nothing was permanently deleted.')


def method(pointer,slot,*types):
    table=c.cast(pointer,c.POINTER(c.POINTER(c.c_void_p))).contents
    return c.WINFUNCTYPE(c.c_long,c.c_void_p,*types)(table[slot])


def item(shell,path):
    result=c.c_void_p();create=shell.SHCreateItemFromParsingName
    create.argtypes=[c.c_wchar_p,c.c_void_p,c.POINTER(GUID),c.POINTER(c.c_void_p)];create.restype=c.c_long
    check(create(str(path),None,c.byref(ITEM),c.byref(result)));return result


def available(path):
    if os.name!='nt': return False
    kernel=c.WinDLL('kernel32',use_last_error=True);get=kernel.GetDriveTypeW;get.argtypes=[c.c_wchar_p];get.restype=c.c_uint
    root=Path(path).anchor
    if get(root) not in {2,3}: return False
    class Info(c.Structure): _fields_=[('size',c.c_uint32),('bytes',c.c_int64),('items',c.c_int64)]
    info=Info(c.sizeof(Info));query=c.WinDLL('shell32').SHQueryRecycleBinW;query.argtypes=[c.c_wchar_p,c.POINTER(Info)];query.restype=c.c_long
    return query(root,c.byref(info))>=0


def recycle(path):
    if os.name!='nt': raise ValueError('Recycle Bin commands require Windows.')
    ole=c.OleDLL('ole32');ole.CoInitializeEx.argtypes=[c.c_void_p,c.c_uint];ole.CoInitializeEx.restype=c.c_long
    initialized=ole.CoInitializeEx(None,2);check(initialized)
    pointers=[]
    try:
        shell=c.WinDLL('shell32');source=item(shell,path);pointers.append(source)
        parent=item(shell,Path(path).parent);pointers.append(parent)
        bin_item=item(shell,BIN);pointers.append(bin_item)
        transfer=c.c_void_p()
        bind=method(parent,3,c.c_void_p,c.POINTER(GUID),c.POINTER(GUID),c.POINTER(c.c_void_p))
        check(bind(parent,None,c.byref(HANDLER),c.byref(TRANSFER),c.byref(transfer)));pointers.append(transfer)
        result=c.c_void_p()
        check(method(transfer,8,c.c_void_p,c.c_void_p,c.c_uint,c.POINTER(c.c_void_p))(transfer,source,bin_item,0,c.byref(result)))
        if not result: raise ValueError('Windows did not return the recycled item. Check Needs attention; nothing was permanently deleted.')
        pointers.append(result);name=c.c_void_p()
        check(method(result,5,c.c_uint,c.POINTER(c.c_void_p))(result,0x80058000,c.byref(name)))
        try: return c.wstring_at(name)
        finally: ole.CoTaskMemFree(name)
    finally:
        for p in reversed(pointers): method(p,2)(p)
        ole.CoUninitialize()


def find(path,stamp,checksum):
    """Find only the recorded original, including a crash before saving its receipt."""
    import struct
    from .library_file_io import relocated
    root=Path(Path(path).anchor)/'$Recycle.Bin'
    # Windows' bin can store the current user's receipts at its root or in a
    # user directory. No receipt or other user's file is ever changed here.
    try: folders=[root]+[p for p in root.iterdir() if p.is_dir()]
    except OSError: return None
    for folder in folders:
        try: receipts=list(folder.glob('$I*'))
        except OSError: continue
        for receipt in receipts:
            try:
                data=receipt.read_bytes();version=struct.unpack_from('<Q',data)[0]
                start=28 if version==2 else 24 if version==1 else None
                if start is None: continue
                old=data[start:].decode('utf-16-le').split('\0',1)[0]
                if os.path.normcase(old)!=os.path.normcase(str(path)): continue
                recycled=receipt.with_name('$R'+receipt.name[2:])
                if relocated(recycled,stamp,checksum): return str(recycled)
            except (OSError,ValueError,struct.error): continue
    return None
