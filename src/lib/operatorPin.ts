/**
 * Derivação da password de Auth para operadores.
 *
 * O PIN tem 6 dígitos e é rejeitado pelo Auth como password fraca
 * ("Password is known to be weak"). Por isso a password real guardada no Auth
 * é derivada do código + PIN, com um prefixo/sufixo fixo. O operador continua
 * a introduzir apenas Código + PIN.
 */
export function operatorEmailForCode(code: string) {
  return `op-${code.trim().toLowerCase()}@upmoveis.local`;
}

export function operatorPasswordFromPin(code: string, pin: string) {
  return `UPfab-${code.trim().toLowerCase()}-${pin}-Op#2026`;
}
