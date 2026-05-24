import { createApp, defineComponent, h } from 'vue';

export function withSetup<T>(composable: () => T): [T, () => void] {
  let result!: T;
  const app = createApp(
    defineComponent({
      setup() {
        result = composable();
        return {};
      },
      render() {
        return h('div');
      }
    })
  );
  app.mount(document.createElement('div'));
  return [result, () => app.unmount()];
}
