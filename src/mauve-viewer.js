/**
 * mauve-viewer.js
 *
 * A JS/d3.js Mauve Viewer
 *
 * Author(s): nconrad
 *
 */

import {Track} from './track';
import {TrackCtrl} from './track-ctrl';
import {BackBone} from './backbone';
import {Cursor} from './cursor';
import template from './container.html';
import {
    marginTop,
    trackOffset,
    hideTrackOffset,
    yPosOffset,
    lcbHeight
} from './consts';



export default class MauveViewer {
    constructor({d3, ele, data, labels}){
        this.ele = ele;
        this.data = data;
        this.d3 = d3;

        this.labels = labels;

        this.hiddenTracks = [];

        this.init();
    }

    init() {
        let {regions} = this.getGenomeRegions(this.data);
        this.genomeRegions = regions;
        this.trackCount = Object.keys(this.genomeRegions).length;

        this.setReference(1, true);  // set first genome as reference

        this.ele.innerHTML = template;
        this.render();
        this.rendered = true;

        this.initControls(); // add global controls
    }

    render() {
        const d3 = this.d3,
            data = this.data;

        const genomeRegions = this.genomeRegions;
        const trackCount = this.trackCount;

        // get highest end value
        const endMax = Math.max(...[].concat.apply([], data).map(region => region.end));
        const xLength = endMax + 100;
        console.log('xLength', xLength)

        // create svg dom element
        d3.select(this.ele.querySelector('svg')).remove();
        const svg = d3.select(this.ele.querySelector('.mv-chart')).append("svg")
            .attr('width', 1000)
            .attr('height', trackCount * 165)

        const width = +svg.attr("width"),
            height = +svg.attr("height");

        /**
         *  ctrl-mousewheel for zoom
         */
        let zoom = d3.zoom()
            .scaleExtent([0, xLength/10])
            .translateExtent([[-width, 0], [width + 100, 0]])
            .on("zoom", zoomed)
            .filter(() => (
                d3.event.ctrlKey ||
                d3.event.type === 'mousedown' ||
                d3.event.type == 'dblclick'
            ))

        svg.call(zoom);

        d3.select(this.ele.querySelector('.reset-btn'))
            .on("click", reset);

        /**
         *  create tracks (axises, scales, gXs)
         */
        let axises = [],
            gXs = [],
            xScales = [],
            tracks = [];

        let yPos = marginTop;
        for (let id = 1; id <= trackCount; id++) {
            let isHidden = this.hiddenTracks.includes(id);
            yPos += id === 1 ? 0 : (isHidden ? hideTrackOffset : trackOffset);

            let name = genomeRegions[id][0].name,
                label = this.labels ? this.labels[name] : '';

            let track = new Track({
                d3, yPos, svg, id, name, label,
                width, xLength,
                hidden: isHidden,
                regions: genomeRegions[id]
            })

            axises.push(track.xAxis);
            gXs.push(track.gX);
            xScales.push(track.x);

            tracks.push(track);

            // only create track ctrls once
            if (this.rendered) continue;

            new TrackCtrl({
                id, yPos, height, container: this.ele,
                svg: this.ele.querySelector('svg'),
                trackCount: this.trackCount,
                isReference: id === 1,
                onMoveUp: id => { this.moveTrackUp(id) },
                onMoveDown: id => { this.moveTrackDown(id) },
                onSetReference: id => { this.setReference(id) },
                onHide: id => { this.hideTrack(id) },
                onShow: id => { this.showTrack(id) }
            })
        }

        let x = xScales[0]; // x scale is same for all tracks


        // add hover cursor lines, initially without x position
        let cursor = new Cursor({
            d3, trackCount, svg,
            scale: x,
            container: this.ele
        })

        // add backbone of lcb lines
        let backbone = new BackBone({
            scale: x, data, d3, svg
        })

        function zoomed() {
            let srcEvent = d3.event.sourceEvent;
            let newScale = d3.event.transform.rescaleX(xScales[0]);

            // scale each axis
            for (let i = 0; i < tracks.length; i++) {
                tracks[i].rescaleAxis();
            }

            // scale all rectangles
            if (!srcEvent || srcEvent.type === 'wheel' || srcEvent.type === 'click') {
                svg.selectAll('.region')
                    .attr('x', (d) => newScale(d.start))
                    .attr("width", (d) => newScale(d.end) - newScale(d.start))
            } else if ((d3.event.sourceEvent.type === 'mousemove')) {
                svg.selectAll('.region')
                  .attr("x", (d) => newScale(d.start) );
            }

            // scale lines
            backbone.scale(newScale);

            cursor.resetHover(newScale);
        }

        function reset() {
            zoom.transform(svg, d3.zoomIdentity);
        }
    }

    moveTrackUp(id) {
        let swapID = id - 1;
        if (swapID < 1) return;

        this.swapTrack(id, swapID);
        this.swapBackbones(id, swapID)
        this.render();
    }

    moveTrackDown(id) {
        let swapID = id + 1;
        if (swapID > this.trackCount) return;

        this.swapTrack(id, swapID);
        this.swapBackbones(id, swapID)
        this.render();
    }

    swapTrack(id, newID) {
        let swapTrack = this.genomeRegions[newID];
        this.genomeRegions[newID] = this.genomeRegions[id];
        this.genomeRegions[id] = swapTrack;
    }

    swapBackbones(oldID, newID) {
        this.data.forEach(lcb => {
            let foundOldRegion = null,
                foundSwapRegion = null;
            lcb.forEach(region => {
                if (region.lcb_idx === oldID)
                    region.lcb_idx = newID;
                else if (region.lcb_idx === newID)
                    region.lcb_idx = oldID;
            })

            lcb.sort((a, b) => a.lcb_idx - b.lcb_idx)
        })
    }

    setReference(id, noRerender) {
        this.data.forEach(lcb => {
            let flipped = false;

            // first determine if reference's (region)
            // strand direction is made positive
            lcb.forEach(region => {
                if (region.lcb_idx !== id) return;

                if (region.strand !== '+') {
                    region.strand = '+';
                    flipped = true
                }
            })

            if (!flipped) return;

            // otherwise, need to flip corresponding regions
            lcb.forEach(region => {
                if (region.lcb_idx === id) return;
                region.strand = region.strand === '-' ? '+' : '-';
            })
        })

        if (noRerender) return;

        this.render();
    }

    hideTrack(id) {
        this.data.forEach(lcbs => {
            lcbs.forEach(region => {
                if (region.lcb_idx == id)
                    region.hidden = true;
            })
        })

        this.hiddenTracks.push(id);
        this.render();
    }

    showTrack(id) {
        this.data.forEach(lcbs => {
            lcbs.forEach(region => {
                if (region.lcb_idx == id)
                    delete region.hidden;
            })
        })

        this.hiddenTracks.splice( this.hiddenTracks.indexOf(id));
        this.render();
    }

    // gets lcbs that have entry for every organism
    // deprecated(?)
    getSharedLCBs(data) {
        let maxRows = Math.max( ...data.map(lcb => lcb.length) );
        let filtered = data.filter(lcbs => lcbs.length === maxRows);
        return filtered;
    }

    // gets regions for each organism (index); adding ids
    // also returns connections of regions
    getGenomeRegions(lcbs) {
        let regions = {};
        let regionID = 0;
        let lcbID = 0;
        lcbs.forEach((lcb, groupID) => {
            //lcb.reverse(); // consider last index reference genome
            lcbID += 1;
            lcb.forEach((region) => {
                // increment/add ids to regions
                regionID += 1;
                region.id = regionID;
                region.groupID = groupID;

                let index = region.lcb_idx;
                if (index in regions)
                    regions[index].push(region);
                else
                    regions[index] = [region];
            })
        })

        return {regions, regionCount: regionID, lcbCount: lcbID};
    }

    initControls() {
        this.ele.querySelector('.opts-btn').onclick = () => {
            this.ele.querySelector(".dd-content").classList.toggle("show");
        }

        document.onclick = (evt) => {
            let dd = this.ele.querySelector('.dropdown');
            if (dd.contains(evt.target)) return;

            if (!evt.target.matches('.dd-btn')) {
                var dds = this.ele.getElementsByClassName("dd-content");
                Array.from(dds).forEach(dd => { dd.classList.remove('show') });
            }
        }
    }

}
