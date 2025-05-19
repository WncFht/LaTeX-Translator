declare module 'config' {
  const config: {
    get<T>(path: string): T;
  };
  export default config;
} 