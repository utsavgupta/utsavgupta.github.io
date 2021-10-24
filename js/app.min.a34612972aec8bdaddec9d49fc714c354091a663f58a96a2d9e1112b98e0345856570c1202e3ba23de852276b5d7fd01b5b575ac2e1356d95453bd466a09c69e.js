const progressbar=document.querySelector("#progress-bar")
const main=document.querySelector("main")
function resizeProgressBar(){let scrollDistance=main.getBoundingClientRect().top
let progresswidth=(scrollDistance/(document.documentElement.clientHeight-main.getBoundingClientRect().height))*100
if(progresswidth<0){progresswidth=0}
progressbar.style.width=progresswidth+"%"}
window.addEventListener("scroll",resizeProgressBar)