const progressbar=document.querySelector("#progress-bar")
const main=document.querySelector("main")
const mainsection=document.querySelector("section.main-content")
const topbutton=document.querySelector("#top-button")
function resizeProgressBar(){let scrollDistance=main.getBoundingClientRect().top
let progresswidth=(scrollDistance/(document.documentElement.clientHeight-main.getBoundingClientRect().height))*100
if(progresswidth<0){progresswidth=0}
if(progresswidth==0){topbutton.style.display="none"}else{topbutton.style.display="block"}
progressbar.style.width=progresswidth+"%"}
function positionTopButton(){let rightOfMain=main.getBoundingClientRect().right;topbutton.style.left=(rightOfMain-topbutton.getBoundingClientRect().width)+"px"}
positionTopButton()
window.addEventListener("scroll",resizeProgressBar)
window.addEventListener("resize",positionTopButton)