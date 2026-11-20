"""Opens a password-protected ODT in LibreOffice (through UNO) and prints its text.

    python3 tests/lib/lo-open-encrypted.py file.odt password profile-dir
"""
import subprocess, sys, time
import uno
from com.sun.star.beans import PropertyValue

path, password, work = sys.argv[1], sys.argv[2], sys.argv[3]
port = 2047
proc = subprocess.Popen(['soffice', f'-env:UserInstallation=file://{work}/lo-uno-profile', '--headless', '--norestore', f'--accept=socket,host=localhost,port={port};urp;'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ctx = None
for _ in range(90):
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        ctx = resolver.resolve(f'uno:socket,host=localhost,port={port};urp;StarOffice.ComponentContext')
        break
    except Exception:
        time.sleep(1)
def pv(n, v):
    p = PropertyValue(); p.Name = n; p.Value = v; return p
desktop = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(path), '_blank', 0, (pv('Hidden', True), pv('Password', password)))
print(doc.getText().getString() if doc else 'NOT OPENED')
if doc:
    doc.close(True)
try:
    desktop.terminate()
except Exception:
    pass
proc.wait(timeout=60)
