let fs = require("fs");
let join = require('path').join;
let d3 = require("d3");
const shell = require("electron").shell;
const os = require("os");

const { remote } = require("electron");
const { Menu, MenuItem } = remote;
let current;

//右键菜单
const menu = new Menu();
menu.append(new MenuItem({
    label: 'open in explorer',
    click: function () {
        if (current) {
            shell.showItemInFolder(current);
        }
    }
}));

window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    menu.popup({ window: remote.getCurrentWindow() })
}, false);

FilesFlower = function (selector, w, h) {
    this.w = w;
    this.h = h;
    this.selector = selector;
    d3.select(selector).selectAll("svg").remove();

    this.svg = d3.select(selector).append("svg:svg")
        .attr('width', w)
        .attr('height', h)
        .attr('id', 'svgcanvas');

    this.svg.append("svg:rect")
        .style("stroke", "#999")
        .style("fill", "#fff")
        .attr('width', w)
        .attr('height', h)
        .attr('id', 'rectcanvas');
    this.filestree = {};
    this.node = {};
    this.link = {};
}

module.exports = FilesFlower

FilesFlower.prototype.resize = function (w, h) {
    this.w = w;
    this.h = h;

    d3.select(this.selector).selectAll("svg").remove();

    this.svg = d3.select(this.selector).append("svg:svg")
        .attr('width', w)
        .attr('height', h)
        .attr('id', 'svgcanvas');

    this.svg.append("svg:rect")
        .style("stroke", "#999")
        .style("fill", "#fff")
        .attr('width', w)
        .attr('height', h)
        .attr('id', 'rectcanvas');
    this.update(null);
}

FilesFlower.prototype.update = function (rootPath) {
    d3.select(this.selector).selectAll("g").remove();
    if (rootPath)
        this.filestree = this.ScanFileSystem(rootPath);
    const nodes = this.flatten(this.filestree);
    if (nodes.length === 1) {
        this.links = [];
    }

    this.svg.selectAll("text").remove();
    this.simulation = d3.forceSimulation(nodes)
        .force("link",
            d3.forceLink(this.links)
                .id(d => d.name)
                .distance(d => d.distance)
        )
        .force("charge",
            d3.forceManyBody()
                .strength(-30)
                .distanceMax(500))
        .force("center",
            d3.forceCenter(this.w / 2, this.h / 2));

    this.link = this.svg.append("g")
        .attr("stroke", "#999")
        .attr("stroke-opacity", 0.6)
        .selectAll("line")
        .data(this.links)
        .join("line")
    //.attr("stroke-width", d => Math.sqrt(d.value));

    this.node = this.svg.append("g")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5)
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", sizec)
        .attr("fill", color)
        .call(this.drag(this.simulation))
        .on("click", this.click.bind(this))
        .on("mouseover", this.mouseover.bind(this))
        .on("mouseout", this.mouseout.bind(this));

    this.simulation.on("tick", () => {
        this.link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);
        this.node
            .attr("cx", d => d.x)
            .attr("cy", d => d.y)
    });

    this.text = this.svg
        .append('svg:text')
        .attr('class', 'nodetext')
        .attr('dy', 0)
        .attr('dx', 0)
        .attr('text-anchor', 'middle');

}
sizec = d => {
    var r = d.filesize / d.root.maxsize;
    return 5 + r * 200;
}
color = d => {
    if (d.root == d)
        return "#CD7054";
    switch (d.type) {
        case "dir":
            return "#9B30FF";
        case "file":
            return "#00CD66";
        case "open_dir":
            return "#EEB422";
        case "root_dir":
            return "#CD7054";
        default:
            break;
    }
}
FilesFlower.prototype.drag = function (simulation) {

    function dragstarted(d) {
        if (!d3.event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(d) {
        d.fx = d3.event.x;
        d.fy = d3.event.y;
    }

    function dragended(d) {
        if (!d3.event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
}

FilesFlower.prototype.click = function (d) {
    if (d.type == "file")
        return;
    if (d.children) {
        d._children = d.children;
        d.children = null;
        d.type = "dir";
        d.filesize = d.rawsize;
    } else {
        d.children = d._children;
        d._children = null;
        d.type = "open_dir";
        d.filesize = 0;

    }
    this.update();
};

FilesFlower.prototype.finder = function (path, parent) {
    let files = fs.readdirSync(path);
    var totalsize = 0;
    files.forEach((val, index) => {
        let fPath = join(path, val);
        let stats = fs.statSync(fPath);
        // 当前文件
        let file = {
            name: fPath,
            path: fPath,
            filesize: stats.size,
            children: null,
            _children: [],
            error: false,
            parent: parent,
            root: parent.root,
            purename: val
        };
        // 加入父节点
        parent._children.push(file);
        try {
            if (stats.isDirectory()) {
                file.type = "dir";
                let subfile = this.finder(fPath, file);
                totalsize += file.filesize;
            }
            if (stats.isFile()) {
                file.type = "file";
                totalsize += file.filesize;
                file.rawsize = file.filesize;
            }
        } catch{
            file.error = true;
        }
    });
    parent.filesize = totalsize;
    parent.rawsize = totalsize;
    return totalsize;
}

/**
   * 
   * @param startPath  起始目录文件夹路径
   * @returns {Array}
   */
FilesFlower.prototype.findSync = function (startPath) {
    let result = [];
    // 根节点
    let root = { name: startPath, path: startPath, purename: startPath, children: null, _children: [], parent: null, type: "root_dir", filesize: 0, distance: 0 }
    root.root = root;
    this.links = [];

    this.finder(startPath, root);
    root.maxsize = root.filesize;
    root.rawsize = root.filesize;
    return root;
}

/**
 * 根据根目录扫描文件系统
 */
FilesFlower.prototype.ScanFileSystem = function (path) {

    let fileNames = this.findSync(path);
    return fileNames;
}

// 展开树
FilesFlower.prototype.flatten = function (root) {
    //this.max = 0;
    var nodes = [];
    var i = 0;
    this.links = [];
    function recurse(node, nodes, links) {

        if (node.children) {
            node.size = node.children.reduce(function (p, v) {
                return p + recurse(v, nodes, links);
            }, 0);
        }

        if (!node.id) node.id = ++i;
        if (node.parent != null) {
            links.push({
                source: node.parent.name,
                target: node.name,
                distance: (node.parent.filesize + node.filesize) / node.root.maxsize * 200 + 30
            });
        }
        node.rsize = node.filesize / node.root.maxsize * 200 + 30
        nodes.push(node);
        return node.size;
    }

    root.size = recurse(root, nodes, this.links);
    return nodes;
}
const kb = 1024;
const mb = 1024 * 1024;
const gb = 1014 * 1024 * 1024;

function filesize2str(filesize) {
    if (filesize < kb)
        return filesize + " B";
    else if (filesize < mb)
        return (filesize / kb).toFixed(2) + " KB";
    else if (filesize < gb)
        return (filesize / mb).toFixed(2) + " MB"
    else return (filesize / gb).toFixed(2) + " GB"
}

FilesFlower.prototype.mouseover = function (d) {
    this.text.attr('transform', 'translate(' + d.x + ',' + (d.y - 5 - (d.children ? 3.5 : Math.sqrt(d.rsize) / 2)) + ')')
        .text(d.name + ": " + filesize2str(d.filesize))
        .style('display', null);
    current = d.name;
};

FilesFlower.prototype.mouseout = function (d) {
    this.text.style('display', 'none');
};