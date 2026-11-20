/* Jogos locais da arquibancada; não acessam contas, permissões ou Firebase. */
(function(root){
 'use strict';
 const lines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
 function outcome(board){for(const [a,b,c] of lines)if(board[a]&&board[a]===board[b]&&board[a]===board[c])return board[a];return board.every(Boolean)?'draw':'';}
 function fresh(){return {board:Array(9).fill(''),result:''};}
 function minimax(board,turn){const result=outcome(board);if(result)return result==='O'?1:result==='X'?-1:0;const scores=[];for(let i=0;i<9;i++)if(!board[i]){board[i]=turn;scores.push(minimax(board,turn==='O'?'X':'O'));board[i]='';}return turn==='O'?Math.max(...scores):Math.min(...scores);}
 function play(current,index){
  if(!Number.isInteger(index)||index<0||index>8||current.result||current.board[index])return current;
  const board=[...current.board];board[index]='X';let result=outcome(board);
  if(!result){let best=-2,choice=-1;for(const i of [4,0,2,6,8,1,3,5,7])if(!board[i]){board[i]='O';const score=minimax(board,'X');board[i]='';if(score>best){best=score;choice=i;}}if(choice>=0)board[choice]='O';result=outcome(board);}
  return {board,result};
 }
 const api=Object.freeze({fresh,play,outcome});if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaFun=api;
})(typeof globalThis==='object'?globalThis:this);
