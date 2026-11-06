// Bridges to Android when running inside the Capacitor app; plain browser fallbacks otherwise.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
import { FileOpener } from '@capacitor-community/file-opener';

export const isNative = () => Capacitor.isNativePlatform();

const toBase64 = blob => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(blob); });

async function writeCache(name, blob) {
  const { uri } = await Filesystem.writeFile({ path: name, data: await toBase64(blob), directory: Directory.Cache });
  return uri;
}

// Save/share a file (backup export)
export async function saveFile(name, blob) {
  if (isNative()) {
    const uri = await writeCache(name, blob);
    await Share.share({ title: name, files: [uri] });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Open a stored statement PDF in the phone's PDF viewer
export async function openPdf(name, blob) {
  if (isNative()) {
    const uri = await writeCache(name.replace(/[^\w.-]+/g, '_'), blob);
    await FileOpener.open({ filePath: uri, contentType: 'application/pdf' });
    return;
  }
  const url = URL.createObjectURL(blob); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Android back button: close an open sheet, else go to Overview, else leave the app
export function onBack(handler) {
  if (isNative()) App.addListener('backButton', () => { if (!handler()) App.exitApp(); });
}
