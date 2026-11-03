// Arena Esportiva - Controle de Operadores e Permissões (Ajuste cirúrgico em app.js)
// Mantém 100% da identidade visual, layout e funcionalidades originais do sistema.
// Permite que operadores gerenciem equipes, jogadores, partidas e placares, sem acesso administrativo geral ou documentação.

async function salvarPermissoesOperador(userId, statusAcesso, partidasSelecionadas, permitirCadastros, motivo) {
    try {
        const db = firebase.firestore();
        await db.collection("usuarios").doc(userId).update({
            statusAcesso: statusAcesso,
            partidasAutorizadas: partidasSelecionadas,
            operadorCadastros: permitirCadastros, // Permite cadastrar e gerenciar equipes, jogadores e partidas
            motivoAlteracao: motivo,
            atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log("Permissões de operador atualizadas com sucesso!");
    } catch (error) {
        console.error("Erro ao salvar permissões:", error);
        throw error;
    }
}

// Lógica de verificação de permissão para operações de jogo
function verificarPermissaoOperador(usuarioAtual, acao) {
    if (!usuarioAtual) return false;
    if (usuarioAtual.admin) return true; // Administrador tem acesso total
    
    // Operadores autorizados podem marcar placares, adicionar jogadores, equipes e criar partidas
    if (usuarioAtual.operadorCadastros || usuarioAtual.operador) {
        const acoesPermitidas = ['cadastrar_equipe', 'cadastrar_jogador', 'criar_partida', 'marcar_placar'];
        return acoesPermitidas.includes(acao);
    }
    
    return false;
}
