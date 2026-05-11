import { useEffect } from 'react';

const isBlockedShortcut = (event) => {
  const key = event.key.toLowerCase();
  return (
    key === 'printscreen' ||
    (event.ctrlKey && ['a', 'c', 'p', 's', 'u'].includes(key)) ||
    (event.ctrlKey && event.shiftKey && ['i', 'j', 'c'].includes(key)) ||
    key === 'f12'
  );
};

const clearClipboard = async () => {
  if (!navigator.clipboard?.writeText) return;

  try {
    await navigator.clipboard.writeText('');
  } catch {
    // Browsers may block clipboard writes without a direct user gesture.
  }
};

const useTestContentProtection = () => {
  useEffect(() => {
    const clearSelection = () => {
      const selection = window.getSelection?.();
      if (selection && selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
    };

    const handleKeyDown = (event) => {
      if (!isBlockedShortcut(event)) return;

      event.preventDefault();
      clearSelection();
      clearClipboard();
    };

    const handleCopy = (event) => {
      event.preventDefault();
      event.clipboardData?.setData('text/plain', '');
      clearSelection();
    };

    const handleBlockedAction = (event) => {
      event.preventDefault();
      clearSelection();
    };

    document.body.classList.add('test-protection-active');
    document.addEventListener('beforecopy', handleBlockedAction, true);
    document.addEventListener('copy', handleCopy, true);
    document.addEventListener('cut', handleBlockedAction, true);
    document.addEventListener('contextmenu', handleBlockedAction, true);
    document.addEventListener('dragstart', handleBlockedAction, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('selectstart', handleBlockedAction, true);
    document.addEventListener('selectionchange', clearSelection, true);

    return () => {
      document.body.classList.remove('test-protection-active');
      document.removeEventListener('beforecopy', handleBlockedAction, true);
      document.removeEventListener('copy', handleCopy, true);
      document.removeEventListener('cut', handleBlockedAction, true);
      document.removeEventListener('contextmenu', handleBlockedAction, true);
      document.removeEventListener('dragstart', handleBlockedAction, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('selectstart', handleBlockedAction, true);
      document.removeEventListener('selectionchange', clearSelection, true);
    };
  }, []);
};

export default useTestContentProtection;
