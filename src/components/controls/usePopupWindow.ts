import { ref, onUnmounted, defineComponent, h, createApp, type Component } from 'vue';

export function usePopupWindow(component: Component, getProps: () => Record<string, unknown>) {
  const isPopupOpen = ref(false);
  let popupWindow: Window | null = null;
  let popupApp: ReturnType<typeof createApp> | null = null;

  function openPopupWindow() {
    if (popupWindow && !popupWindow.closed) {
      popupWindow.focus();
      return;
    }

    const popup = window.open(
      '',
      'controlPanel',
      'width=560,height=720,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no,left=100,top=100'
    );
    if (!popup) return;

    popupWindow = popup;
    popup.document.title = 'Controls';

    Array.from(document.styleSheets).forEach((sheet) => {
      try {
        if (sheet.href) {
          const link = popup.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = sheet.href;
          popup.document.head.appendChild(link);
        } else if (sheet.cssRules) {
          const style = popup.document.createElement('style');
          style.textContent = Array.from(sheet.cssRules)
            .map((r) => r.cssText)
            .join('\n');
          popup.document.head.appendChild(style);
        }
      } catch {
        // ignore CORS errors
      }
    });

    const container = popup.document.createElement('div');
    popup.document.body.appendChild(container);

    const Root = defineComponent({
      render: () => h(component, getProps())
    });

    popupApp = createApp(Root);
    popupApp.mount(container);
    isPopupOpen.value = true;

    popup.addEventListener('beforeunload', () => {
      isPopupOpen.value = false;
      popupWindow = null;
      popupApp = null;
    });
  }

  onUnmounted(() => {
    if (popupWindow && !popupWindow.closed) popupWindow.close();
    if (popupApp) popupApp.unmount();
  });

  return { isPopupOpen, openPopupWindow };
}
