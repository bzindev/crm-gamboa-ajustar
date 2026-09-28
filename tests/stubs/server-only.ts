// O pacote "server-only" só existe pra quebrar o build se código de
// servidor for parar no navegador — nos testes (Node puro) ele não tem o
// que proteger, e importá-lo de verdade lançaria erro.
export {};
