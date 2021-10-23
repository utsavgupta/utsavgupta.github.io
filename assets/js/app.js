function resizeProgressBar() {
    let progressbar = document.querySelector("#progress-bar")
    let mainsection = document.querySelector("main")

    let scrollDistance = mainsection.getBoundingClientRect().top
    let progresswidth = (scrollDistance / (document.documentElement.clientHeight - mainsection.getBoundingClientRect().height)) * 100

    if (progresswidth < 0) {
        progresswidth = 0
    }

    progressbar.style.width = progresswidth + "%"
}

window.addEventListener("scroll", resizeProgressBar)