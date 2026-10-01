import { checkUpload, cleanFileName, storageExtension } from './attachments.rules';

const MAX = 10 * 1024 * 1024;

describe('checkUpload', () => {
  it('accepts a receipt photo and a PDF letter', () => {
    expect(checkUpload({ fileName: 'HMK-R-55120.jpg', mimeType: 'image/jpeg', size: 200_000 }, MAX)).toBeNull();
    expect(checkUpload({ fileName: 'HMK-NOTICE-0926.pdf', mimeType: 'application/pdf', size: 90_000 }, MAX)).toBeNull();
  });

  it('names the size limit when a file is too large', () => {
    expect(checkUpload({ fileName: 'big.pdf', mimeType: 'application/pdf', size: MAX + 1 }, MAX)).toBe(
      'The file is too large. The limit is 10 MB.',
    );
  });

  it('refuses empty files and other types', () => {
    expect(checkUpload({ fileName: 'a.pdf', mimeType: 'application/pdf', size: 0 }, MAX)).toBe('The file is empty.');
    expect(checkUpload({ fileName: 'a.exe', mimeType: 'application/x-msdownload', size: 10 }, MAX)).toMatch(/Only photos/);
  });
});

describe('storageExtension / cleanFileName', () => {
  it('takes the extension from the checked type, not the name', () => {
    expect(storageExtension('image/png')).toBe('.png');
    expect(storageExtension('text/html')).toBe('');
  });

  it('strips folders and quotes from the original name', () => {
    expect(cleanFileName('C:\\Users\\x\\"DO".pdf')).toBe('DO.pdf');
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('')).toBe('file');
  });
});
