// Babel config untuk RN + WatermelonDB.
// WatermelonDB models pakai @decorator (legacy) — plugin WAJIB di sini.
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    ['@babel/plugin-proposal-decorators', { legacy: true }],
    [
      '@babel/plugin-transform-class-properties',
      { loose: true },
      // HARUS diletakkan setelah proposal-decorators
    ],
  ],
};