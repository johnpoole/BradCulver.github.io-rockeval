// WellViewApp: Main namespace for the Kerogen data visualization application.
var WellViewApp = {
  // --- Configuration & State ---
  origin: [500, 375], // Initial origin for 3D projection.
  scale: 5,           // Initial scale for 3D projection.
  key: function(d) { return d.id; }, // Key function for D3 data joins.
  startAngleX: 2.356194490192345,  // Initial rotation angle around X-axis (Math.PI / 4).
  startAngleY: 0.7034435724342363, // Initial rotation angle around Y-axis (Math.PI / 8).
  wellIDFocus: "None", // ID of the currently focused well, "None" for no focus.

  svg: null, // Main SVG container, initialized in viz.setupSVG.

  // Mouse state variables for drag interactions.
  mx: null, my: null, mouseX: null, mouseY: null,

  // --- D3 Scales ---
  scales: {
    ZScale: d3.scaleLinear().range([0, 100]), // Scale for Z-axis data.
    XScale: d3.scaleLinear().range([0, 100]), // Scale for X-axis data.
    YScale: d3.scaleLinear().range([0, 100]), // Scale for Y-axis data.
    color: null // Color scale, initialized in viz.initD33DObjects based on config.colorList.
  },

  // --- D3 3D Objects ---
  // These objects handle the 3D projection and path generation.
  d3_3d: {
    grid3d: null,   // For the 3D grid plane.
    point3d: null,  // For 3D data points.
    yScale3d: null  // For 3D axis lines (historically named yScale3d but used for all axes).
  },

  // --- Application Configuration ---
  config: {
    zCategory: "hi",     // Default category for Z-axis.
    xCategory: "oi",     // Default category for X-axis.
    yCategory: "s2s3",   // Default category for Y-axis.
    vCategory: "toc",    // Default category for color values.
    // Default color palette for data points.
    colorList: ['#d53e4f', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#e6f598', '#abdda4', '#66c2a5', '#3288bd']
  },

  // --- Data Storage ---
  data: {
    wells: [],    // Filtered well data used for the current visualization.
    allWells: [], // All well data loaded from the CSV file.

    // Loads data from "data.csv", populates dropdowns, and executes a callback.
    load: function(callback) {
      d3.csv("data.csv", (error, loadedData) => {
        if (error) {
          console.error("Error loading data.csv:", error);
          // Display a user-friendly error message on the page.
          d3.select('body').insert('div', ':first-child')
            .attr('class', 'error-message')
            .style('color', 'red')
            .style('padding', '10px')
            .html("<strong>Error:</strong> Could not load data.csv. Please check the file and console for details. The application may not function correctly.");

          // Initialize with empty data to prevent further errors if possible, then callback.
          this.allWells = [];
          this.wells = [];
          if (callback) callback();
          return;
        }

        this.allWells = loadedData;
        this.wells = this.allWells; // Initially, display all wells.

        // Populate dropdown menus for category selection.
        if (this.allWells.length > 0 && this.allWells.columns) {
          const columns = this.allWells.columns;
          d3.select("#color").selectAll("option").data(columns).enter().append("option").text(d => d);
          d3.select("#xaxis").selectAll("option").data(columns).enter().append("option").text(d => d);
          d3.select("#yaxis").selectAll("option").data(columns).enter().append("option").text(d => d);
          d3.select("#zaxis").selectAll("option").data(columns).enter().append("option").text(d => d);
        } else {
          console.warn("No data or columns found in data.csv. Dropdowns will not be populated.");
        }

        // Populate dropdown for focusing on a specific well.
        var wellIDs = d3.map(this.allWells, d => d.wellID).keys();
        wellIDs.unshift("None"); // Add "None" to show all wells.
        d3.select("#well").selectAll("option").data(wellIDs).enter().append("option").text(d => d);

        if (callback) callback(); // Execute the callback to continue application setup.
      });
    },

    // Exports the currently filtered well data to a CSV file named "export.csv".
    exportData: function() {
      if (!this.wells || this.wells.length === 0) {
        alert("No data available to export.");
        return;
      }
      let rows = [];
      // Add header row using keys from the first data object.
      if (this.wells[0]) {
        rows.push(Object.keys(this.wells[0]));
      }

      this.wells.forEach(well => {
        rows.push(Object.values(well));
      });
      this.exportToCsv('export.csv', rows);
    },

    // Helper function to convert an array of rows into a CSV string and trigger download.
    exportToCsv: function(filename, rows) {
      var processRow = function(row) {
        var finalVal = '';
        for (var j = 0; j < row.length; j++) {
          var innerValue = row[j] === null ? '' : row[j].toString();
          if (row[j] instanceof Date) {
            innerValue = row[j].toLocaleString();
          }
          var result = innerValue.replace(/"/g, '""'); // Escape double quotes.
          if (result.search(/("|,|\n)/g) >= 0) {
            result = '"' + result + '"'; // Enclose in double quotes if it contains special characters.
          }
          if (j > 0) finalVal += ',';
          finalVal += result;
        }
        return finalVal + '\n';
      };

      var csvFile = rows.map(processRow).join('');

      var blob = new Blob([csvFile], { type: 'text/csv;charset=utf-8;' });
      if (navigator.msSaveBlob) { // IE 10+
        navigator.msSaveBlob(blob, filename);
      } else {
        var link = document.createElement("a");
        if (link.download !== undefined) { // Modern browsers
          var url = URL.createObjectURL(blob);
          link.setAttribute("href", url);
          link.setAttribute("download", filename);
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }
    }
  },

  // --- Visualization Module ---
  viz: {
    // Object to hold data arrays prepared for D3 rendering (e.g., points, grid lines).
    dataForDrawing: {
      xGrid: [], scatter: [], yLine: [], xLine: [], zLine: []
    },

    // Sets up the main SVG container and drag behavior.
    setupSVG: function() {
      WellViewApp.svg = d3.select('svg')
        .call(d3.drag()
          .on('drag', WellViewApp.viz.dragged)
          .on('start', WellViewApp.viz.dragStart)
          .on('end', WellViewApp.viz.dragEnd))
        .append('g');
    },

    // Initializes the D3 3D objects used for projecting and drawing 3D elements.
    initD33DObjects: function() {
      var reversedColorList = [...WellViewApp.config.colorList].reverse();
      WellViewApp.scales.color = d3.scaleQuantize().range(reversedColorList);

      // grid3d: Defines the 3D grid plane.
      WellViewApp.d3_3d.grid3d = d3._3d()
        .shape('GRID', 10) // Defines a grid with 10 lines in each direction.
        .origin(WellViewApp.origin)
        .rotateY(WellViewApp.startAngleY)
        .rotateX(WellViewApp.startAngleX)
        .scale(WellViewApp.scale);

      // point3d: Defines how individual data points (wells) are projected in 3D.
      WellViewApp.d3_3d.point3d = d3._3d()
        .x(d => d.x).y(d => d.y).z(d => d.z) // Accessors for coordinates.
        .origin(WellViewApp.origin)
        .rotateY(WellViewApp.startAngleY)
        .rotateX(WellViewApp.startAngleX)
        .scale(WellViewApp.scale);

      // yScale3d: Defines how lines (used for axes) are projected in 3D.
      WellViewApp.d3_3d.yScale3d = d3._3d()
        .shape('LINE_STRIP') // Defines a series of connected line segments.
        .origin(WellViewApp.origin)
        .rotateY(WellViewApp.startAngleY)
        .rotateX(WellViewApp.startAngleX)
        .scale(WellViewApp.scale);
    },

    // Processes and renders the 3D visualization data (grid, points, axes).
    // `data` is an array containing pre-processed 3D data. `tt` is transition duration.
    processData: function(processedData, tt) {
      // --- GRID Rendering ---
      // Selects, binds data, and draws the 3D grid lines.
      var xGrid = WellViewApp.svg.selectAll('path.grid').data(processedData[0], WellViewApp.key);

    xGrid
      .enter()
      .append('path')
      .attr('class', '_3d grid')
      .merge(xGrid)
      .attr('stroke', 'black')
      .attr('stroke-width', 0.3)
      .attr('fill', function(d) {
        return d.ccw ? '#717171' : 'lightgrey';
      })
      .attr('fill-opacity', 0.9)
      .attr('d', WellViewApp.d3_3d.grid3d.draw); // Uses the grid3d object to draw the path
      xGrid.exit().remove();

      // --- POINTS Rendering ---
      // Selects, binds data, and draws the 3D data points (wells) as circles.
      var points = WellViewApp.svg.selectAll('circle').data(processedData[1], WellViewApp.key);
      points.enter()
        .append('circle')
        .attr('class', '_3d') // Class for D3 3D sorting.
        .attr('opacity', 0)   // Start transparent for fade-in effect.
        .attr('cx', WellViewApp.viz.posPointX) // X position from projection.
        .attr('cy', WellViewApp.viz.posPointY) // Y position from projection.
        .merge(points)
        .transition().duration(tt) // Apply transition for attribute changes.
        .attr('r', d => (d.wellID === WellViewApp.wellIDFocus ? 6 : 3)) // Radius changes if well is focused.
        .attr('stroke', d => d3.color(WellViewApp.scales.color(d.value)).darker(3)) // Border color from scale.
        .attr('fill', d => WellViewApp.scales.color(d.value)) // Fill color from scale.
        .attr('opacity', 1) // Fade in.
        .attr('cx', WellViewApp.viz.posPointX)
        .attr('cy', WellViewApp.viz.posPointY);
      points.exit().remove();

      // --- Y-AXIS Line Rendering ---
      var yScale = WellViewApp.svg.selectAll('path.yScale').data(processedData[2]);
      yScale.enter()
        .append('path')
        .attr('class', '_3d yScale')
        .merge(yScale)
        .attr('stroke', 'black')
        .attr('stroke-width', 0.5)
        .attr('d', WellViewApp.d3_3d.yScale3d.draw); // Uses yScale3d to draw the path.
      yScale.exit().remove();

      // --- Y-AXIS Text Labels Rendering ---
      var yText = WellViewApp.svg.selectAll('text.yText').data(processedData[2][0]);
      yText.enter()
        .append('text')
        .attr('class', '_3d yText')
        .attr('dx', '.3em')
        .merge(yText)
        .each(d => { d.centroid = { x: d.rotated.x, y: d.rotated.y, z: d.rotated.z }; }) // Store rotated position for sorting.
        .attr('x', d => d.projected.x)
        .attr('y', d => d.projected.y)
        .attr('stroke', (d,i,nodes) => (i === Math.floor((nodes.length -1) / 2) ? 'black' : '')) // Emphasize middle label.
        .text((d,i,nodes) => {
          if (i === Math.floor((nodes.length-1) / 2)) return `[${WellViewApp.config.yCategory}]`; // Display category name.
          return WellViewApp.scales.YScale.invert(d[1]).toFixed(2); // Display scaled value.
        });
      yText.exit().remove();

      // --- X-AXIS Text Labels Rendering ---
      var xText = WellViewApp.svg.selectAll('text.xText').data(processedData[3][0]);
      xText.enter()
        .append('text')
        .attr('class', '_3d xText')
        .attr('dx', '.3em')
        .merge(xText)
        .each(d => { d.centroid = { x: d.rotated.x, y: d.rotated.y, z: d.rotated.z }; })
        .attr('x', d => d.projected.x)
        .attr('y', d => d.projected.y)
        .attr('stroke', (d,i,nodes) => (i === Math.floor((nodes.length-1) / 2) ? 'black' : ''))
        .text((d,i,nodes) => {
          if (i === 0) return ""; // Skip first label (often origin).
          if (i === Math.floor((nodes.length-1) / 2)) return `[${WellViewApp.config.xCategory}]`;
          return Math.round(WellViewApp.scales.XScale.invert(d[0]) * 100) / 100;
        });
      xText.exit().remove();

      // --- Z-AXIS Text Labels Rendering ---
      var zText = WellViewApp.svg.selectAll('text.zText').data(processedData[4][0]);
      zText.enter()
        .append('text')
        .attr('class', '_3d zText')
        .attr('dx', '.3em')
        .merge(zText)
        .each(d => { d.centroid = { x: d.rotated.x, y: d.rotated.y, z: d.rotated.z }; })
        .attr('x', d => d.projected.x)
        .attr('y', d => d.projected.y)
        .attr('stroke', (d,i,nodes) => (i === Math.floor((nodes.length-1) / 2) ? 'black' : ''))
        .text((d,i,nodes) => {
          if (i === 0) return "";
          if (i === Math.floor((nodes.length-1) / 2)) return `[${WellViewApp.config.zCategory}]`;
          return Math.round(WellViewApp.scales.ZScale.invert(d[2]) * 100) / 100;
        });
      zText.exit().remove();

      // Sorts all elements with class '_3d' to ensure correct Z-ordering for depth perception.
      d3.selectAll('._3d').sort(d3._3d().sort);

      // --- LEGEND Rendering ---
      // Uses d3.legendColor to create/update the color legend.
      var legendsvg = d3.select(".mainsvg");
      legendsvg.select(".legendLinear").remove(); // Remove existing legend.
      legendsvg.append("g") // Append a new group for the legend.
        .attr("class", "legendLinear")
        .attr("transform", "translate(20,20)"); // Position the legend.

      var legendLinear = d3.legendColor()
        .shapeWidth(30)    // Width of legend color swatches.
        .cells(10)         // Number of color cells in the legend.
        .orient('vertical') // Orientation of the legend.
        .title(WellViewApp.config.vCategory) // Title (current color variable).
        .scale(WellViewApp.scales.color);    // The color scale to use.
      legendsvg.select(".legendLinear").call(legendLinear); // Render the legend.
    },

    // Helper function to get the X-coordinate for a projected point.
    posPointX: function(d) { return d.projected.x || ""; },
    // Helper function to get the Y-coordinate for a projected point.
    posPointY: function(d) { return d.projected.y || ""; }, // Should always have a Y.

    // --- Drag Event Handlers ---
    dragStart: function() {
      WellViewApp.mx = d3.event.x;
      WellViewApp.my = d3.event.y;
    },
    dragged: function() {
      WellViewApp.mouseX = WellViewApp.mouseX || 0;
      WellViewApp.mouseY = WellViewApp.mouseY || 0;
      // Calculate rotation angles based on mouse movement.
      var beta = (d3.event.x - WellViewApp.mx + WellViewApp.mouseX) * Math.PI / 230 * (-1);
      var alpha = (d3.event.y - WellViewApp.my + WellViewApp.mouseY) * Math.PI / 230 * (-1);

      // Prepare data for re-rendering with new rotations.
      var data = [
        WellViewApp.d3_3d.grid3d.rotateY(beta + WellViewApp.startAngleY).rotateX(alpha - WellViewApp.startAngleX)(WellViewApp.viz.dataForDrawing.xGrid),
        WellViewApp.d3_3d.point3d.rotateY(beta + WellViewApp.startAngleY).rotateX(alpha - WellViewApp.startAngleX)(WellViewApp.viz.dataForDrawing.scatter),
        WellViewApp.d3_3d.yScale3d.rotateY(beta + WellViewApp.startAngleY).rotateX(alpha - WellViewApp.startAngleX)([WellViewApp.viz.dataForDrawing.yLine]),
        WellViewApp.d3_3d.yScale3d.rotateY(beta + WellViewApp.startAngleY).rotateX(alpha - WellViewApp.startAngleX)([WellViewApp.viz.dataForDrawing.xLine]),
        WellViewApp.d3_3d.yScale3d.rotateY(beta + WellViewApp.startAngleY).rotateX(alpha - WellViewApp.startAngleX)([WellViewApp.viz.dataForDrawing.zLine])
      ];
      WellViewApp.viz.processData(data, 0); // Re-render with no transition delay.
    },
    dragEnd: function() {
      // Store the final mouse position for the next drag operation.
      WellViewApp.mouseX = d3.event.x - WellViewApp.mx + WellViewApp.mouseX;
      WellViewApp.mouseY = d3.event.y - WellViewApp.my + WellViewApp.mouseY;
    },
    // Optimized function to update only point radii when well focus changes.
    updatePointRadii: function() {
        if (!WellViewApp.svg) return; // Ensure SVG is initialized
        WellViewApp.svg.selectAll('circle._3d')
            .transition().duration(200) // Short transition for visual feedback
            .attr('r', function(d) {
                return d.wellID === WellViewApp.wellIDFocus ? 6 : 3; // Larger radius for focused well
            });
    }
  },

  // --- UI Interaction / Event Handlers ---
  ui: {
    updateV: function() {
      WellViewApp.config.vCategory = this.value;
      WellViewApp.initVisualization(); // Full re-render for color change
    },
    updateX: function() {
      WellViewApp.config.xCategory = this.value;
      WellViewApp.crossfilterModule.buildCrossFilters(); // Rebuild filters for new axis
      // initVisualization is called by buildCrossFilters -> renderCharts
    },
    updateY: function() {
      WellViewApp.config.yCategory = this.value;
      WellViewApp.crossfilterModule.buildCrossFilters();
    },
    updateZ: function() {
      WellViewApp.config.zCategory = this.value;
      WellViewApp.crossfilterModule.buildCrossFilters();
    },
    updateWellFocus: function() {
      WellViewApp.wellIDFocus = this.value;
      WellViewApp.viz.updatePointRadii(); // Optimized: only update radii
    },
    sliderInputHandler: function() {
      WellViewApp.ui.setScale(this.value / 2);
      // setOriginX/Y also call initVisualization.
      // For pure scale changes, a lighter refresh might be possible if extents don't change.
      WellViewApp.initVisualization(); // Currently, full re-render.
    },
    keydownHandler: function(e) {
      switch (e.keyCode) {
        case 37: WellViewApp.ui.setOriginX(--WellViewApp.origin[0]); break; // Left arrow
        case 38: WellViewApp.ui.setOriginY(--WellViewApp.origin[1]); break; // Up arrow
        case 39: WellViewApp.ui.setOriginX(++WellViewApp.origin[0]); break; // Right arrow
        case 40: WellViewApp.ui.setOriginY(++WellViewApp.origin[1]); break; // Down arrow
      }
    },
    setScale: function(scale) {
      WellViewApp.scale = scale;
      // Update scale on all 3D objects.
      WellViewApp.d3_3d.grid3d.scale(scale);
      WellViewApp.d3_3d.point3d.scale(scale);
      WellViewApp.d3_3d.yScale3d.scale(scale);
      // Note: initVisualization() will be called by sliderInputHandler after this.
    },
    setOriginX: function(originX) {
      WellViewApp.origin[0] = originX;
      WellViewApp.d3_3d.grid3d.origin(WellViewApp.origin);
      WellViewApp.d3_3d.point3d.origin(WellViewApp.origin);
      WellViewApp.d3_3d.yScale3d.origin(WellViewApp.origin);
      WellViewApp.initVisualization(); // Re-render with new origin.
    },
    setOriginY: function(originY) {
      WellViewApp.origin[1] = originY;
      WellViewApp.d3_3d.grid3d.origin(WellViewApp.origin);
      WellViewApp.d3_3d.point3d.origin(WellViewApp.origin);
      WellViewApp.d3_3d.yScale3d.origin(WellViewApp.origin);
      WellViewApp.initVisualization(); // Re-render with new origin.
    }
  },

  // --- Crossfilter Logic ---
  // Manages data filtering and coordination between charts.
  crossfilterModule: {
    wellCrossfilter: null, // The main Crossfilter instance.
    xDimension: null, yDimension: null, zDimension: null, // Dimensions for each category.

    // Utility function to determine group bins for Crossfilter dimensions.
    groupSize: function(d, extent) {
      if (!extent || extent[0] === undefined || extent[1] === undefined || extent[0] === extent[1]) return d; // Avoid division by zero or NaN
      var binsize = Math.abs(extent[1] - extent[0]) / 100.0; // Aim for roughly 100 bins.
      return Math.floor(d / binsize) * binsize; // Snap value to the bin.
    },

    // Builds or rebuilds Crossfilter dimensions, groups, and associated charts.
    buildCrossFilters: function() {
      if (!this.wellCrossfilter) { // Ensure wellCrossfilter is initialized
          if (WellViewApp.data.allWells.length > 0) {
              this.wellCrossfilter = crossfilter(WellViewApp.data.allWells);
          } else {
              console.error("Cannot build crossfilters: allWells data is empty.");
              return;
          }
      }
      // Dispose of existing dimensions to prevent memory leaks.
      if (this.xDimension) this.xDimension.dispose();
      if (this.yDimension) this.yDimension.dispose();
      if (this.zDimension) this.zDimension.dispose();

      const formatNumber = d3.format(',d'); // D3 formatter for counts.

      // Calculate extents for current categories. Used for chart scale domains.
      var XExtent = d3.extent(WellViewApp.data.allWells, d => parseFloat(d[WellViewApp.config.xCategory]));
      var YExtent = d3.extent(WellViewApp.data.allWells, d => parseFloat(d[WellViewApp.config.yCategory]));
      var ZExtent = d3.extent(WellViewApp.data.allWells, d => parseFloat(d[WellViewApp.config.zCategory]));
      if (!XExtent[0] || !XExtent[1]) XExtent = [0,1]; // Default if extent is invalid
      if (!YExtent[0] || !YExtent[1]) YExtent = [0,1];
      if (!ZExtent[0] || !ZExtent[1]) ZExtent = [0,1];

      const all = this.wellCrossfilter.groupAll(); // Group for counting all records.

      // Create dimensions and groups for each category.
      this.xDimension = this.wellCrossfilter.dimension(d => parseFloat(d[WellViewApp.config.xCategory]));
      const xGroup = this.xDimension.group(d => this.groupSize(d, XExtent));

      this.yDimension = this.wellCrossfilter.dimension(d => parseFloat(d[WellViewApp.config.yCategory]));
      const yGroup = this.yDimension.group(d => this.groupSize(d, YExtent));

      this.zDimension = this.wellCrossfilter.dimension(d => parseFloat(d[WellViewApp.config.zCategory]));
      const zGroup = this.zDimension.group(d => this.groupSize(d, ZExtent));

      // Define chart configurations.
      var charts = [
        this.barChart().title(WellViewApp.config.xCategory).dimension(this.xDimension).group(xGroup).x(d3.scaleLinear().domain(XExtent).rangeRound([0, 250])),
        this.barChart().title(WellViewApp.config.yCategory).dimension(this.yDimension).group(yGroup).x(d3.scaleLinear().domain(YExtent).rangeRound([0, 250])),
        this.barChart().title(WellViewApp.config.zCategory).dimension(this.zDimension).group(zGroup).x(d3.scaleLinear().domain(ZExtent).rangeRound([0, 250]))
      ];

      const chartElements = d3.selectAll('.chart').data(charts); // Bind charts to DOM.
      d3.selectAll('#total').text(formatNumber(this.wellCrossfilter.size())); // Update total count.

      // Function to render all charts and update visualization.
      this.renderCharts = function() {
        chartElements.each(function(chart) { d3.select(this).call(chart); });
        d3.select('#active').text(formatNumber(all.value())); // Update active count.
        WellViewApp.data.wells = this.xDimension.top(Infinity); // Update filtered data.
        WellViewApp.initVisualization(); // Re-render 3D plot.
      }.bind(this); // Bind `this` context for renderCharts.

      this.renderCharts(); // Initial render.

      // Expose filter and reset globally for chart interactions.
      window.filter = (filters) => {
        filters.forEach((d, i) => { charts[i].filter(d); });
        this.renderCharts();
      };
      window.reset = (i) => {
        charts[i].filter(null);
        this.renderCharts();
      };
    },
    // Reusable bar chart component (factory function).
    // Detailed comments for this function are extensive and placed below its definition.
    barChart: function() {
        // (barChart implementation as previously defined with comments)
        if (!this.barChart.id) this.barChart.id = 0;
        let margin = {top: 10, right: 13, bottom: 20, left: 10},
            x,
            y = d3.scaleLinear().range([50, 0]),
            id = this.barChart.id++,
            axis = d3.axisBottom(),
            brush = d3.brushX(),
            brushDirty,
            dimension,
            group,
            round,
            gBrush,
            title;

        function chart(div) {
            const width = x.range()[1];
            const height = y.range()[0];
            brush.extent([[0,0],[width,height]]);
            if (group && group.top(1)[0]) {
                 y.domain([0, group.top(1)[0].value]);
            } else {
                 y.domain([0,0]);
            }

            div.each(function() {
                const div = d3.select(this);
                let g = div.select("g");
                var currentTitle = div.select(".title b").text();

                if (g.empty() || currentTitle !== title) {
                    div.select(".title b").text(title);
                    div.select(".title a.reset").remove();
                    div.select(".title").append("a")
                        .attr("href", "javascript:reset(" + id + ")")
                        .attr("class", "reset")
                        .text("reset")
                        .style("display", "none");
                    div.select("svg").remove();
                    g = div.append("svg")
                        .attr("width", width + margin.left + margin.right)
                        .attr("height", height + margin.top + margin.bottom)
                      .append("g")
                        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");
                    g.append("clipPath")
                        .attr("id", "clip-" + id)
                      .append("rect")
                        .attr("width", width)
                        .attr("height", height);
                    g.selectAll(".bar")
                        .data(["background", "foreground"])
                      .enter().append("path")
                        .attr("class", function(d) { return d + " bar"; })
                        .datum(group.all());
                    g.selectAll(".foreground.bar")
                        .attr("clip-path", "url(#clip-" + id + ")");
                    g.append("g")
                        .attr("class", "axis")
                        .attr("transform", "translate(0," + height + ")")
                        .call(axis.scale(x));
                    gBrush = g.append("g")
                        .attr("class", "brush")
                        .call(brush);
                    gBrush.selectAll(".handle--custom")
                        .data([{type: "w"}, {type: "e"}])
                        .enter().append("path")
                          .attr("class", "brush-handle")
                          .attr("cursor", "ew-resize")
                          .attr("d", resizePath)
                          .style("display", "none");
                }
                if (brushDirty) {
                    brushDirty = false;
                    div.select(".title a.reset").style("display", d3.brushSelection(div.select(".brush").node()) ? null : "none");
                    if (!d3.brushSelection(div.select(".brush").node())) {
                        g.call(brush.move, null);
                        g.selectAll("#clip-" + id + " rect")
                            .attr("x", 0)
                            .attr("width", width);
                        g.selectAll(".brush-handle").style("display","none");
                    } else {
                        const range = d3.brushSelection(div.select(".brush").node()).map(x.invert);
                        brush.move(gBrush, range.map(x));
                    }
                }
                g.selectAll(".bar").attr("d", barPath);
            });

            function barPath(groups) {
                const path = [];
                let i = -1, n = groups.length, d;
                while (++i < n) {
                    d = groups[i];
                    if (x(d.key) !== undefined && y(d.value) !== undefined && !isNaN(x(d.key)) && !isNaN(y(d.value))) {
                         path.push("M", x(d.key), ",", height, "V", y(d.value), "h9V", height);
                    }
                }
                return path.join("");
            }
            function resizePath(d) {
                const e = +(d.type === "e"), x_rp = e ? 1 : -1, y_rp = height / 3;
                return "M" + (.5 * x_rp) + "," + y_rp + "A6,6 0 0 " + e + " " + (6.5 * x_rp) + "," + (y_rp + 6) + "V" + (2 * y_rp - 6) + "A6,6 0 0 " + e + " " + (.5 * x_rp) + "," + (2 * y_rp) + "Z" + "M" + (2.5 * x_rp) + "," + (y_rp + 8) + "V" + (2 * y_rp - 8) + "M" + (4.5 * x_rp) + "," + (y_rp + 8) + "V" + (2 * y_rp - 8);
            }
        }
        brush.on("start.chart", function() {
            const div = d3.select(this.parentNode.parentNode.parentNode);
            div.select(".title a.reset").style("display", null);
        });
        brush.on("brush.chart", function() {
            const g = d3.select(this.parentNode);
            const brushRange = d3.event.selection || d3.brushSelection(this.parentNode);
            const xRange = x && x.range();
            let activeRange = brushRange || xRange;
            const hasRange = activeRange && activeRange.length === 2 && !isNaN(activeRange[0]) && !isNaN(activeRange[1]);
            if (!hasRange) return;
            let extents = activeRange.map(x.invert);
            if (round) {
                extents = extents.map(round);
                activeRange = extents.map(x);
                if (d3.event.sourceEvent && d3.event.sourceEvent.type === "mousemove") {
                    d3.select(this).call(brush.move, activeRange);
                }
            }
            g.selectAll(".brush-handle").style("display", null).attr("transform", (d,i) => "translate(" + activeRange[i] + ",0)");
            g.select("#clip-" + id + " rect").attr("x", activeRange[0]).attr("width", activeRange[1] - activeRange[0]);
            dimension.filterRange(extents);
            if(WellViewApp.crossfilterModule.renderCharts) WellViewApp.crossfilterModule.renderCharts();
        });
        brush.on("end.chart", function() {
            if (!d3.brushSelection(this)) {
                if(window.reset) window.reset(id);
            }
        });
        chart.margin = function(_) { if (!arguments.length) return margin; margin = _; return chart; };
        chart.x = function(_) { if (!arguments.length) return x; x = _; axis.scale(x); return chart; };
        chart.y = function(_) { if (!arguments.length) return y; y = _; return chart; };
        chart.dimension = function(_) { if (!arguments.length) return dimension; dimension = _; return chart; };
        chart.title = function(_) { if (!arguments.length) return title; title = _; return chart; };
        chart.filter = _ => { if (!_) dimension.filterAll(); brushDirty = _; return chart; };
        chart.group = function(_) { if (!arguments.length) return group; group = _; return chart; };
        chart.round = function(_) { if (!arguments.length) return round; round = _; return chart; };
        chart.gBrush = () => gBrush;
        return chart;
    }
  },

  // --- Main Visualization Setup ---
  // Initializes and prepares data for the 3D scatter plot.
  initVisualization: function() {
    var cnt = 0; // Counter for point IDs.
    // Clear existing data arrays.
    this.viz.dataForDrawing.xGrid = [];
    this.viz.dataForDrawing.scatter = [];
    this.viz.dataForDrawing.yLine = [];
    this.viz.dataForDrawing.xLine = [];
    this.viz.dataForDrawing.zLine = [];

    // Calculate data extents for current categories.
    var ZExtent = d3.extent(this.data.wells, d => parseFloat(d[this.config.zCategory]));
    var XExtent = d3.extent(this.data.wells, d => parseFloat(d[this.config.xCategory]));
    var YExtent = d3.extent(this.data.wells, d => parseFloat(d[this.config.yCategory]));
    var VExtent = d3.extent(this.data.wells, d => parseFloat(d[this.config.vCategory]));
    // Default extents if data is empty or invalid.
    if (!ZExtent[0] || !ZExtent[1]) ZExtent = [0,1];
    if (!XExtent[0] || !XExtent[1]) XExtent = [0,1];
    if (!YExtent[0] || !YExtent[1]) YExtent = [0,1];
    if (!VExtent[0] || !VExtent[1]) VExtent = [0,1];

    // Update scale domains.
    this.scales.color.domain(VExtent);
    this.scales.ZScale.domain(ZExtent).nice();
    this.scales.XScale.domain(XExtent).nice();
    // Special handling for Y-axis log scale.
    if (this.config.yCategory === "s2s3") {
      this.scales.YScale = d3.scaleLog().range([0, 100]);
      const yExtentLog = [...YExtent];
      if (yExtentLog[0] <= 0) yExtentLog[0] = 0.01; // Clamp to small positive for log scale.
      if (yExtentLog[1] <= 0) yExtentLog[1] = 0.1;
      this.scales.YScale.domain(yExtentLog);
    } else {
      this.scales.YScale = d3.scaleLinear().range([0, 100]);
      this.scales.YScale.domain(YExtent).nice();
    }

    // Prepare scatter data with scaled coordinates.
    this.data.wells.forEach(d => {
      let yVal = parseFloat(d[this.config.yCategory]);
      if (this.config.yCategory === "s2s3" && yVal <= 0) yVal = 0.01;
      this.viz.dataForDrawing.scatter.push({
        x: this.scales.XScale(parseFloat(d[this.config.xCategory])),
        y: this.scales.YScale(yVal),
        z: this.scales.ZScale(parseFloat(d[this.config.zCategory])),
        id: 'point_' + cnt++,
        value: parseFloat(d[this.config.vCategory]), // Ensure value is float for color scale
        wellID: d.wellID
      });
    });

    // Generate grid and axis line data.
    for (var z = 0; z <= 100; z += 10) {
      for (var x = 0; x <= 100; x += 10) {
        this.viz.dataForDrawing.xGrid.push([x, 0, z]); // Grid on Y=0 plane
      }
    }
    d3.range(0, 101, 10).forEach(d => this.viz.dataForDrawing.yLine.push([0, d, 0]));
    d3.range(0, 101, 10).forEach(d => this.viz.dataForDrawing.xLine.push([d, 0, 0]));
    d3.range(0, 101, 10).forEach(d => this.viz.dataForDrawing.zLine.push([0, 0, d]));

    // Prepare data for rendering (apply 3D transformations).
    var dataToRender = [
      this.d3_3d.grid3d(this.viz.dataForDrawing.xGrid),
      this.d3_3d.point3d(this.viz.dataForDrawing.scatter),
      this.d3_3d.yScale3d([this.viz.dataForDrawing.yLine]),
      this.d3_3d.yScale3d([this.viz.dataForDrawing.xLine]),
      this.d3_3d.yScale3d([this.viz.dataForDrawing.zLine])
    ];
    this.viz.processData(dataToRender, 1000); // Render with 1s transition.
  },

  // --- Application Start ---
  // Initializes the application components and starts the visualization.
  start: function() {
    this.viz.setupSVG();             // Setup main SVG area.
    this.viz.initD33DObjects();      // Initialize D3 3D helper objects.
    this.data.load(() => {           // Load data, then...
      this.crossfilterModule.buildCrossFilters(); // Setup Crossfilter and charts.
                                                // buildCrossFilters calls initVisualization internally.
      // Setup UI event listeners.
      d3.select('#color').on('change', this.ui.updateV.bind(this.ui));
      d3.select('#xaxis').on('change', this.ui.updateX.bind(this.ui));
      d3.select('#yaxis').on('change', this.ui.updateY.bind(this.ui));
      d3.select('#zaxis').on('change', this.ui.updateZ.bind(this.ui));
      d3.select('#well').on('change', this.ui.updateWellFocus.bind(this.ui));
      document.getElementById("myRange").oninput = this.ui.sliderInputHandler.bind(this.ui);
      document.onkeydown = this.ui.keydownHandler.bind(this.ui);
      const exportButton = document.getElementById("exportButton");
      if (exportButton) {
        exportButton.addEventListener('click', this.data.exportData.bind(this.data));
      }
    });
  }
};

// --- Global Functions (Legacy, to be fully integrated or removed) ---
// These are currently referenced by HTML or the bar chart's reset functionality.
// Consider refactoring them into the WellViewApp structure if possible.
var wellCrossfilter = WellViewApp.crossfilterModule.wellCrossfilter; // For barChart reset.
var xDimension = WellViewApp.crossfilterModule.xDimension;
var yDimension = WellViewApp.crossfilterModule.yDimension;
var zDimension = WellViewApp.crossfilterModule.zDimension;
var origin = WellViewApp.origin;
var scale = WellViewApp.scale;
var key = WellViewApp.key;
var startAngleX = WellViewApp.startAngleX;
var startAngleY = WellViewApp.startAngleY;
var wellIDFocus = WellViewApp.wellIDFocus;
var ZScale = WellViewApp.scales.ZScale;
var XScale = WellViewApp.scales.XScale;
var YScale = WellViewApp.scales.YScale;
var svg = WellViewApp.svg; // This will be null until setupSVG is called.
var color = WellViewApp.scales.color; // Also null until initD33DObjects.
var zCategory = WellViewApp.config.zCategory;
var xCategory = WellViewApp.config.xCategory;
var yCategory = WellViewApp.config.yCategory;
var vCategory = WellViewApp.config.vCategory;
var mx = WellViewApp.mx, my = WellViewApp.my, mouseX = WellViewApp.mouseX, mouseY = WellViewApp.mouseY;
var grid3d = WellViewApp.d3_3d.grid3d;
var point3d = WellViewApp.d3_3d.point3d;
var yScale3d = WellViewApp.d3_3d.yScale3d;
var wells = WellViewApp.data.wells;
var allWells = WellViewApp.data.allWells;

// Shim for old function names if directly called from HTML or legacy parts.
function processData(data, tt) { WellViewApp.viz.processData(data, tt); }
function posPointX(d) { return WellViewApp.viz.posPointX(d); }
function posPointY(d) { return WellViewApp.viz.posPointY(d); }
function init() { WellViewApp.initVisualization(); }
function dragged() { WellViewApp.viz.dragged(); }
function dragStart() { WellViewApp.viz.dragStart(); }
function dragEnd() { WellViewApp.viz.dragEnd(); }
function buildCrossFilters() { WellViewApp.crossfilterModule.buildCrossFilters(); }
function groupSize(d, extent) { return WellViewApp.crossfilterModule.groupSize(d, extent); }
// exportData and exportToCsv are on WellViewApp.data, event listener is set up in start()

// Start the application once the DOM is ready.
document.addEventListener('DOMContentLoaded', function() {
  WellViewApp.start();
});

// Legacy slider and keydown handlers (should be fully managed by WellViewApp.ui)
// var slider = document.getElementById("myRange");
// slider.oninput = ... // now WellViewApp.ui.sliderInputHandler
// document.onkeydown = ... // now WellViewApp.ui.keydownHandler

// Legacy d3.csv loading (now in WellViewApp.data.load)
/*
d3.csv("data.csv", function(data) { ... });
*/

// Legacy barChart (now WellViewApp.crossfilterModule.barChart)
/*
function barChart() { ... }
*/

  // Update the current slider value (each time you drag the slider handle)
  slider.oninput = function() {
    setScale(this.value / 2);
    //setOriginX( this.value*5);
    init();
  }
  document.onkeydown = function(e) {
    switch (e.keyCode) {
      case 37:
        setOriginX(--origin[0]);
        break;
      case 38:
        setOriginY(--origin[1]);
        break;
      case 39:
        setOriginX(++origin[0]);
        break;
      case 40:
        setOriginY(++origin[1]);
        break;
    }
  };

  function setScale(scale) {
    grid3d.scale(scale);
    point3d.scale(scale);
    yScale3d.scale(scale);
  }

  function setOriginX(originX) {
    origin[0] = originX;
    grid3d.origin(origin);
    point3d.origin(origin);
    yScale3d.origin(origin);
    init();

  }

  function setOriginY(originY) {
    origin[1] = originY;
    grid3d.origin(origin);
    point3d.origin(origin);
    yScale3d.origin(origin);
    init();
  }

  function buildCrossFilters() {

    console.log(allWells.length);
    if (typeof xDimension !== 'undefined') {
      xDimension.dispose();
      yDimension.dispose();
      zDimension.dispose();
    }
    // Various formatters.
    const formatNumber = d3.format(',d');

    var ZExtent = d3.extent(allWells, function(d) {
      return parseFloat(d[zCategory]);
    });
    var XExtent = d3.extent(allWells, function(d) {
      return parseFloat(d[xCategory]);
    });
    var YExtent = d3.extent(allWells, function(d) {
      return parseFloat(d[yCategory]);
    });
    var VExtent = d3.extent(allWells, function(d) {
      return parseFloat(d[vCategory]);
    });

    const all = wellCrossfilter.groupAll();

    xDimension = wellCrossfilter.dimension(d => parseFloat(d[xCategory]));
    const xGroup = xDimension.group(function(d) {
      return groupSize(d, XExtent);
    });

    zDimension = wellCrossfilter.dimension(d => parseFloat(d[zCategory]));
    const zGroup = zDimension.group(function(d) {
      return groupSize(d, ZExtent);
    });

    yDimension = wellCrossfilter.dimension(d => parseFloat(d[yCategory]));
    const yGroup = yDimension.group(function(d) {
      return groupSize(d, YExtent);
    });

    var charts = [

      barChart()
      .title(xCategory)
      .dimension(xDimension)
      .group(xGroup)
      .x(d3.scaleLinear()
        .domain(d3.extent(allWells, function(d) {
          return parseFloat(d[xCategory]);
        }))
        .rangeRound([0, 250])),

      barChart()
      .title(zCategory)
      .dimension(zDimension)
      .group(zGroup)
      .x(d3.scaleLinear()
        .domain(d3.extent(allWells, function(d) {
          return parseFloat(d[zCategory]);
        }))
        .rangeRound([0, 250])),

      barChart()
      .title(yCategory)
      .dimension(yDimension)
      .group(yGroup)
      .x(d3.scaleLinear()
        .domain(d3.extent(allWells, function(d) {
          return parseFloat(d[yCategory]);
        }))
        .rangeRound([0, 250])),
    ];

    // Given our array of charts, which we assume are in the same order as the
    // .chart elements in the DOM, bind the charts to the DOM and render them.
    // We also listen to the chart's brush events to update the display.
    const chart = d3.selectAll('.chart')
      .data(charts);

    // Render the total.
    d3.selectAll('#total')
      .text(formatNumber(wellCrossfilter.size()));

    renderAll();

    // Renders the specified chart or list.
    function render(method) {
      d3.select(this).call(method);
    }

    // Whenever the brush moves, re-rendering everything.
    function renderAll() {
      chart.each(render);
      //  list.each(render);
      d3.select('#active').text(formatNumber(all.value()));
      wells = xDimension.top(Infinity);
      init();
    }

    window.filter = filters => {
      filters.forEach((d, i) => {
        charts[i].filter(d);
      });
      renderAll();
    };

    window.reset = i => {
      charts[i].filter(null);
      renderAll();
    };

    function barChart() {
      if (!barChart.id) barChart.id = 0;

      let margin = {
        top: 10,
        right: 13,
        bottom: 20,
        left: 10
      };
      let x;
      let y = d3.scaleLinear().range([50, 0]);
      const id = barChart.id++;
      const axis = d3.axisBottom();
      var brush = d3.brushX();
      let brushDirty;
      let dimension;
      let group;
      let round;
      let gBrush;
      let title;

      function chart(div) {
        const width = x.range()[1];
        const height = y.range()[0];

        brush.extent([
          [0, 0],
          [width, height]
        ]);

        y.domain([0, group.top(1)[0].value]); //highest count?
        div.each(function() {
          const div = d3.select(this);
          let g = div.select('g');

          // Create the skeletal chart.//check for a new category
          var currentTitle = div.select('.title').select('b').text();

          if (g.empty() || currentTitle != title) {

            div.select('.title').select('b').text(title);
            div.select('.title').append('a')
              .attr('href', `javascript:reset(${id})`)
              .attr('class', 'reset')
              .text('reset')
              .style('display', 'none');
            div.select('svg').remove();
            g = div.append('svg')
              .attr('width', width + margin.left + margin.right)
              .attr('height', height + margin.top + margin.bottom)
              .append('g')
              .attr('transform', `translate(${margin.left},${margin.top})`);

            g.append('clipPath')
              .attr('id', `clip-${id}`)
              .append('rect')
              .attr('width', width)
              .attr('height', height);

            g.selectAll('.bar')
              .data(['background', 'foreground'])
              .enter().append('path')
              .attr('class', d => `${d} bar`)
              .datum(group.all());

            g.selectAll('.foreground.bar')
              .attr('clip-path', `url(#clip-${id})`);

            g.append('g')
              .attr('class', 'axis')
              .attr('transform', `translate(0,${height})`)
              .call(axis);

            // Initialize the brush component with pretty resize handles.
            //?? remove the brush here?
            //  g.selectAll('.brush').remove();
            gBrush = g.append('g')
              .attr('class', 'brush')
              .call(brush);

            gBrush.selectAll('.handle--custom')
              .data([{
                type: 'w'
              }, {
                type: 'e'
              }])
              .enter().append('path')
              .attr('class', 'brush-handle')
              .attr('cursor', 'ew-resize')
              .attr('d', resizePath)
              .style('display', 'none');
          }

          // Only redraw the brush if set externally.
          if (brushDirty !== false) {
            const filterVal = brushDirty;
            brushDirty = false;

            div.select('.title a').style('display', d3.brushSelection(div) ? null : 'none');

            if (!filterVal) {
              g.call(brush);

              g.selectAll(`#clip-${id} rect`)
                .attr('x', 0)
                .attr('width', width);

              g.selectAll('.brush-handle').style('display', 'none');
            } else {
              const range = filterVal.map(x);
              brush.move(gBrush, range);
            }
          }

          g.selectAll('.bar').attr('d', barPath);
        });

        function barPath(groups) { //groups is the list of values and their count for each set of bars
          const path = [];
          let i = -1;
          const n = groups.length;
          let d;
          while (++i < n) {
            d = groups[i];
            path.push('M', x(d.key), ',', height, 'V', y(d.value), 'h9V', height);
          }
          return path.join('');
        }

        function resizePath(d) {
          const e = +(d.type === 'e');
          const x = e ? 1 : -1;
          const y = height / 3;
          return `M${0.5 * x},${y}A6,6 0 0 ${e} ${6.5 * x},${y + 6}V${2 * y - 6}A6,6 0 0 ${e} ${0.5 * x},${2 * y}ZM${2.5 * x},${y + 8}V${2 * y - 8}M${4.5 * x},${y + 8}V${2 * y - 8}`;
        }
      }

      brush.on('start.chart', function() {
        const div = d3.select(this.parentNode.parentNode.parentNode);
        div.select('.title a').style('display', null);
      });

      brush.on('brush.chart', function() {
        const g = d3.select(this.parentNode);
        const brushRange = d3.event.selection || d3.brushSelection(this); // attempt to read brush range
        const xRange = x && x.range(); // attempt to read range from x scale
        let activeRange = brushRange || xRange; // default to x range if no brush range available
        const hasRange = activeRange &&
          activeRange.length === 2 &&
          !isNaN(activeRange[0]) &&
          !isNaN(activeRange[1]);

        if (!hasRange) return; // quit early if we don't have a valid range

        // calculate current brush extents using x scale
        let extents = activeRange.map(x.invert);

        // if rounding fn supplied, then snap to rounded extents
        // and move brush rect to reflect rounded range bounds if it was set by user interaction
        if (round) {
          extents = extents.map(round);
          activeRange = extents.map(x);

          if (
            d3.event.sourceEvent &&
            d3.event.sourceEvent.type === 'mousemove'
          ) {
            d3.select(this).call(brush.move, activeRange);
          }
        }

        // move brush handles to start and end of range
        g.selectAll('.brush-handle')
          .style('display', null)
          .attr('transform', (d, i) => `translate(${activeRange[i]}, 0)`);

        // resize sliding window to reflect updated range
        g.select(`#clip-${id} rect`)
          .attr('x', activeRange[0])
          .attr('width', activeRange[1] - activeRange[0]);

        // filter the active dimension to the range extents
        dimension.filterRange(extents);

        // re-render the other charts accordingly
        renderAll();
      });

      brush.on('end.chart', function() {
        // reset corresponding filter if the brush selection was cleared
        // (e.g. user "clicked off" the active range)
        if (!d3.brushSelection(this)) {
          reset(id);
        }
      });

      chart.margin = function(_) {
        if (!arguments.length) return margin;
        margin = _;
        return chart;
      };

      chart.x = function(_) {
        if (!arguments.length) return x;
        x = _;
        axis.scale(x);
        return chart;
      };

      chart.y = function(_) {
        if (!arguments.length) return y;
        y = _;
        return chart;
      };

      chart.dimension = function(_) {
        if (!arguments.length) return dimension;
        dimension = _;
        return chart;
      };

      chart.title = function(_) {
        if (!arguments.length) return title;
        title = _;
        return chart;
      };

      chart.filter = _ => {
        if (!_) dimension.filterAll();
        brushDirty = _;
        return chart;
      };

      chart.group = function(_) {
        if (!arguments.length) return group;
        group = _;
        return chart;
      };

      chart.round = function(_) {
        if (!arguments.length) return round;
        round = _;
        return chart;
      };

      chart.gBrush = () => gBrush;

      return chart;
    }
  }

  function groupSize(d, extent) {
    var binsize = (Math.floor(extent[1] - extent[0]) * 100) / 10000.0;
    var ret = Math.floor(d / binsize);
    ret *= binsize
    return ret;
  }

  function exportData() {
    let rows = [];
    var row = [];
    Object.keys(wells[0]).forEach(function(d) {
      row.push(d);
    });
    rows.push(row)


    wells.forEach(function(all) {
      row = [];
      Object.values(all).forEach(function(d) {
        row.push(d);
      })
      rows.push(row)
      //    console.log( all)
    })
    exportToCsv('export.csv', rows);
  }

  function exportToCsv(filename, rows) {
    var processRow = function(row) {
      var finalVal = '';
      for (var j = 0; j < row.length; j++) {
        var innerValue = row[j] === null ? '' : row[j].toString();
        if (row[j] instanceof Date) {
          innerValue = row[j].toLocaleString();
        };
        var result = innerValue.replace(/"/g, '""');
        if (result.search(/("|,|\n)/g) >= 0)
          result = '"' + result + '"';
        if (j > 0)
          finalVal += ',';
        finalVal += result;
      }
      return finalVal + '\n';
    };

    var csvFile = '';
    for (var i = 0; i < rows.length; i++) {
      csvFile += processRow(rows[i]);
    }

    var blob = new Blob([csvFile], {
      type: 'text/csv;charset=utf-8;'
    });
    if (navigator.msSaveBlob) { // IE 10+
      navigator.msSaveBlob(blob, filename);
    } else {
      var link = document.createElement("a");
      if (link.download !== undefined) { // feature detection
        // Browsers that support HTML5 download attribute
        var url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
  }
