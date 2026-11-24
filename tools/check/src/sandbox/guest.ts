/**
 * ゲストより先にホストが流す、信頼できる前置きと補助関数。ゲストのコードは混ざらない。
 *
 * - 時計（Date）、eval、Function を消し、関数の種類ごとの constructor も潰す。
 * - 乱数は決まった値に置き換える。
 * - JSON 化は、ゲストが JSON.stringify を差し替えても元の実装を使い続ける。
 */

/** QuickJS 自身に渡すメモリの上限。WASM 全体の上限 64MiB の内側に置く。 */
export const GUEST_MEMORY_BYTES = 40 * 1024 * 1024;

/** スタックの上限。 */
export const GUEST_STACK_BYTES = 512 * 1024;

/** ゲストの実行時間の期限。 */
export const GUEST_DEADLINE_MS = 1000;

/** describe() の戻り値を JSON にしたときの上限。 */
export const MAX_DESCRIBE_BYTES = 256 * 1024;

export const PRELUDE = `(function () {
  "use strict";
  var samples = [function () {}, async function () {}, function* () {}, async function* () {}];
  var seen = [];
  for (var i = 0; i < samples.length; i += 1) {
    var proto = Object.getPrototypeOf(samples[i]);
    if (seen.indexOf(proto) !== -1) { continue; }
    seen.push(proto);
    Object.defineProperty(proto, "constructor", {
      value: undefined,
      configurable: false,
      writable: false
    });
  }
  delete globalThis.Function;
  delete globalThis.eval;
  delete globalThis.Date;
  var fixed = function () { return 0.42000000000000004; };
  Object.defineProperty(Math, "random", { value: fixed, configurable: false, writable: false });
})();`;

export const HELPERS = `(function () {
  var stringify = JSON.stringify;
  var charCodeAt = String.prototype.charCodeAt;
  return {
    encode: function (value, maxBytes) {
      var text;
      try {
        text = stringify(value);
      } catch (error) {
        return { kind: "bad" };
      }
      if (typeof text !== "string") { return { kind: "bad" }; }
      var bytes = 0;
      for (var i = 0; i < text.length; i += 1) {
        var code = charCodeAt.call(text, i);
        if (code < 0x80) { bytes += 1; }
        else if (code < 0x800) { bytes += 2; }
        else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i += 1; }
        else { bytes += 3; }
        if (bytes > maxBytes) { return { kind: "too-large" }; }
      }
      return { kind: "ok" };
    }
  };
})()`;
